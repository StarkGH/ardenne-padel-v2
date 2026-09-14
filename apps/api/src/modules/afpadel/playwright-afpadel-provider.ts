import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { logger } from "@ardenne/shared";
import type { AfpadelProvider, AfpMemberListRow, AfpPlayerDetail } from "./afpadel-provider.js";

/**
 * Connecteur réel, sur le même modèle que
 * `padel-service/tournament/server/afpadel/PlaywrightAfPadelProvider.ts`
 * (déjà validé en conditions réelles sur mon.afpadel.be) : AFPadel est une
 * SPA Inertia.js — chaque page embarque son état complet en JSON.
 *
 * Pagination de /club confirmée réelle le 2026-09-14 par inspection directe
 * (voir apps/api/src/scripts/diagnose-afpadel.ts, supprimé une fois ceci
 * validé) : cliquer "Suivant" déclenche un fetch Vue interne (pas une
 * vraie navigation Inertia — l'attribut `data-page` de `#app` ne se met
 * jamais à jour), mais cette requête est directement rejouable via
 * `page.request.get` avec les en-têtes `X-Inertia`/`X-Inertia-Version`
 * (celle-ci lue sur le chargement initial), en faisant varier `from`. La
 * pagination n'est PAS un simple `page=N` : c'est une fenêtre glissante de
 * 100 éléments — `from=100` sur un club de 117 membres renvoie la fenêtre
 * [17,116] (toujours 100 résultats, chevauchant la page précédente plutôt
 * que de renvoyer un reliquat de 17), `paging.next` indique le prochain
 * `from` à utiliser (`-1` = dernière page). D'où la déduplication par id
 * dans la boucle ci-dessous : indispensable, pas une simple précaution.
 */

export interface PlaywrightAfpadelConfig {
  loginUrl: string;
  clubUrl: string;
  login: string;
  password: string;
  headless: boolean;
  timeoutMs?: number;
  dataDir?: string;
}

const SELECTORS = {
  loginEmail: "input#email",
  loginPassword: "input#password",
  loginSubmit: 'button[type="submit"]',
  loggedInMarker: 'a[href*="/logout"]',
} as const;

const DEFAULT_TIMEOUT_MS = 20000;

// Champs confirmés réels le 2026-09-14 sur props.players[] de la réponse
// JSON de /club (voir commentaire de tête de fichier).
interface RawAfpPlayerListEntry {
  id: number;
  official_name: string;
  sex: string | null;
  license_name: string | null;
  points: number | null;
}

interface ClubPageResponse {
  version: string;
  props: {
    players: RawAfpPlayerListEntry[];
    paging: { from: number; to: number; total: number; next: number; prev: number };
  };
}

export class PlaywrightAfpadelProvider implements AfpadelProvider {
  private readonly config: Required<Omit<PlaywrightAfpadelConfig, "dataDir">> & { dataDir: string };
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private authenticated = false;

  constructor(config: PlaywrightAfpadelConfig) {
    this.config = {
      loginUrl: config.loginUrl,
      clubUrl: config.clubUrl,
      login: config.login,
      password: config.password,
      headless: config.headless,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      dataDir: config.dataDir ?? path.resolve(process.cwd(), "data/afpadel"),
    };
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
    this.authenticated = false;
  }

  private async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.browser = this.browser ?? (await chromium.launch({ headless: this.config.headless }));
    this.context = await this.browser.newContext();
    this.context.setDefaultTimeout(this.config.timeoutMs);
    this.page = await this.context.newPage();
    return this.page;
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    return page
      .locator(SELECTORS.loggedInMarker)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
  }

  async authenticate(): Promise<void> {
    const page = await this.getPage();
    await page.goto(this.config.loginUrl, { waitUntil: "domcontentloaded", timeout: this.config.timeoutMs });
    if (await this.isLoggedIn(page)) {
      this.authenticated = true;
      return;
    }
    const emailInput = page.locator(SELECTORS.loginEmail).first();
    const passwordInput = page.locator(SELECTORS.loginPassword).first();
    if ((await emailInput.count()) === 0 || (await passwordInput.count()) === 0) {
      throw new Error("Formulaire de connexion AFPadel introuvable (sélecteur à revalider).");
    }
    await emailInput.fill(this.config.login);
    await passwordInput.fill(this.config.password); // jamais loggé
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: this.config.timeoutMs }).catch(() => {}),
      page.locator(SELECTORS.loginSubmit).first().click(),
    ]);
    if (!(await this.isLoggedIn(page))) {
      throw new Error("Authentification AFPadel refusée : identifiants invalides ou page de connexion inattendue.");
    }
    this.authenticated = true;
    logger.info({ event: "AfpadelAuthenticated" }, "authentification AFPadel réussie");
  }

  private async ensureAuthenticated(page: Page): Promise<void> {
    if (this.authenticated && (await this.isLoggedIn(page))) return;
    await this.authenticate();
  }

  private toMemberRow(entry: RawAfpPlayerListEntry): AfpMemberListRow {
    return {
      afpPlayerId: entry.id,
      fullName: entry.official_name,
      gender: entry.sex ?? null,
      category: entry.license_name ?? null,
      points: entry.points ?? null,
      raw: entry,
    };
  }

  async listClubMembers(): Promise<AfpMemberListRow[]> {
    const page = await this.getPage();
    await this.ensureAuthenticated(page);
    await page.goto(this.config.clubUrl, { waitUntil: "domcontentloaded", timeout: this.config.timeoutMs });
    const initial = await this.readFullInertiaPage<ClubPageResponse>(page);

    const members: AfpMemberListRow[] = [];
    const seenIds = new Set<number>();
    const addPage = (data: ClubPageResponse) => {
      for (const entry of data.props.players) {
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        members.push(this.toMemberRow(entry));
      }
    };
    addPage(initial);

    let next = initial.props.paging.next;
    let iterations = 0;
    const maxIterations = 50; // garde-fou anti-boucle infinie si `next` ne finit jamais par valoir -1.
    while (next >= 0 && iterations < maxIterations) {
      const url = `${this.config.clubUrl}?filters[elo][]=50&filters[elo][]=3500&filters[search]=&license_year=6&from=${next}`;
      const response = await page.request.get(url, {
        headers: { "X-Inertia": "true", "X-Inertia-Version": initial.version, Accept: "application/json" },
      });
      if (!response.ok()) {
        throw new Error(`Pagination AFPadel : réponse ${response.status()} pour from=${next}`);
      }
      const data = (await response.json()) as ClubPageResponse;
      addPage(data);
      logger.info({ event: "AfpadelMemberPageParsed", from: next, totalSoFar: members.length }, "page de membres AFPadel lue");
      next = data.props.paging.next;
      iterations++;
    }

    return members;
  }

  private async readFullInertiaPage<T extends { version: string }>(page: Page): Promise<T> {
    const raw = await page.locator("#app").getAttribute("data-page");
    if (!raw) throw new Error("Données de page (Inertia data-page) introuvables.");
    return JSON.parse(raw) as T;
  }

  private async readInertiaProps<T>(page: Page): Promise<T> {
    const full = await this.readFullInertiaPage<{ version: string; props: T }>(page);
    return full.props;
  }

  async getPlayerDetail(afpPlayerId: number): Promise<AfpPlayerDetail> {
    const page = await this.getPage();
    await this.ensureAuthenticated(page);
    const origin = new URL(this.config.clubUrl).origin;
    await page.goto(`${origin}/player/${afpPlayerId}`, { waitUntil: "domcontentloaded", timeout: this.config.timeoutMs });
    const props = await this.readInertiaProps<{ player: unknown }>(page);
    return { raw: props.player };
  }
}
