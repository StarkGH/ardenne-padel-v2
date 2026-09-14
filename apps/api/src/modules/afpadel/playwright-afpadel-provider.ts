import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { logger } from "@ardenne/shared";
import type { AfpadelProvider, AfpMemberListRow, AfpPlayerDetail } from "./afpadel-provider.js";

/**
 * Connecteur réel, sur le même modèle que
 * `padel-service/tournament/server/afpadel/PlaywrightAfPadelProvider.ts`
 * (déjà validé en conditions réelles sur mon.afpadel.be) :
 * - AFPadel est une SPA Inertia.js — chaque page embarque son état complet
 *   en JSON dans l'attribut `data-page` de `#app`, bien plus fiable que des
 *   sélecteurs DOM pour des données structurées (fiche joueur notamment).
 * - La liste des membres du club, elle, n'a été inspectée qu'une fois via
 *   capture d'écran (pas encore en conditions réelles avec un compte) — le
 *   parsing ci-dessous lit le texte visible de chaque ligne
 *   ("{id} - {nom} ({icône} {♂|♀} - {points})", confirmé sur la capture
 *   fournie le 2026-09-14) plutôt que de deviner la forme des props
 *   Inertia. `raw` conserve tout (innerHTML) pour permettre d'affiner sans
 *   nouveau déploiement si le format diffère en pratique.
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
  memberRow: "li",
  nextPageButton: 'button:has-text("Suivant"), a:has-text("Suivant")',
} as const;

const DEFAULT_TIMEOUT_MS = 20000;

// "9234014 - Aimery Léonard (♂ - 205)" — capture id / nom / symbole de genre / points.
// L'icône de catégorie (trophée/graduation/soleil) est une icône SVG/font sans texte : elle est
// lue séparément (titre/aria-label/classe) plutôt que dans ce texte, cf. parseMemberRow.
const MEMBER_ROW_PATTERN = /^(\d+)\s*-\s*(.+?)\s*\(([^)]*)\)\s*$/;

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

  /**
   * Extrait `{id, fullName, gender, points}` du texte visible d'une ligne
   * ("9234014 - Aimery Léonard (♂ - 205)"), et la catégorie depuis l'icône
   * précédant le symbole de genre (titre/aria-label si présent, sinon la
   * classe CSS brute — à affiner après un premier passage réel, cf. commentaire
   * de tête de fichier).
   */
  private async parseMemberRow(rowText: string, rowHtml: string): Promise<AfpMemberListRow | null> {
    const match = MEMBER_ROW_PATTERN.exec(rowText.trim());
    if (!match) return null;
    const [, idRaw, fullName, inside] = match;
    const genderMatch = /[♂♀]/.exec(inside!);
    const pointsMatch = /(\d+)\s*\)?$/.exec(inside!) ?? /(\d+)/.exec(inside!);
    const categoryTitleMatch = /title="([^"]+)"|aria-label="([^"]+)"/.exec(rowHtml);
    return {
      afpPlayerId: Number(idRaw),
      fullName: fullName!.trim(),
      gender: genderMatch ? genderMatch[0] : null,
      category: categoryTitleMatch ? categoryTitleMatch[1] ?? categoryTitleMatch[2] ?? null : null,
      points: pointsMatch ? Number(pointsMatch[1]) : null,
      raw: { text: rowText.trim(), html: rowHtml },
    };
  }

  async listClubMembers(): Promise<AfpMemberListRow[]> {
    const page = await this.getPage();
    await this.ensureAuthenticated(page);
    await page.goto(this.config.clubUrl, { waitUntil: "domcontentloaded", timeout: this.config.timeoutMs });

    const members: AfpMemberListRow[] = [];
    const seenIds = new Set<number>();
    let pageIndex = 0;
    const maxPages = 50; // garde-fou anti-boucle infinie si la pagination ne se termine jamais comme attendu.

    while (pageIndex < maxPages) {
      const rows = page.locator(SELECTORS.memberRow).filter({ hasText: /^\s*\d+\s*-/ });
      const count = await rows.count();
      let addedThisPage = 0;
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const [text, html] = await Promise.all([row.innerText(), row.innerHTML()]);
        const parsed = await this.parseMemberRow(text, html);
        if (parsed && !seenIds.has(parsed.afpPlayerId)) {
          seenIds.add(parsed.afpPlayerId);
          members.push(parsed);
          addedThisPage++;
        }
      }
      logger.info({ event: "AfpadelMemberPageParsed", pageIndex, addedThisPage, totalSoFar: members.length }, "page de membres AFPadel lue");

      const nextButton = page.locator(SELECTORS.nextPageButton).first();
      const hasNext = (await nextButton.count()) > 0 && (await nextButton.isEnabled().catch(() => false));
      if (!hasNext || addedThisPage === 0) break;
      await Promise.all([page.waitForLoadState("networkidle", { timeout: this.config.timeoutMs }).catch(() => {}), nextButton.click()]);
      pageIndex++;
    }

    return members;
  }

  private async readInertiaProps<T>(page: Page): Promise<T> {
    const raw = await page.locator("#app").getAttribute("data-page");
    if (!raw) throw new Error("Données de page (Inertia data-page) introuvables sur la fiche joueur AFPadel.");
    return JSON.parse(raw).props as T;
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
