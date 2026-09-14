import type { AfpMember } from "@prisma/client";

const CSV_COLUMNS: Array<{ header: string; value: (m: AfpMember) => string }> = [
  { header: "N° AFPadel", value: (m) => String(m.afpPlayerId) },
  { header: "Nom", value: (m) => m.fullName },
  { header: "Catégorie", value: (m) => m.category ?? "" },
  { header: "Sexe", value: (m) => m.gender ?? "" },
  { header: "Points", value: (m) => (m.points !== null ? String(m.points) : "") },
  { header: "Club", value: (m) => m.clubName ?? "" },
  { header: "Âge/catégorie", value: (m) => m.ageCategory ?? "" },
  { header: "Nationalité", value: (m) => m.nationality ?? "" },
  { header: "Email", value: (m) => m.email ?? "" },
  { header: "Téléphone", value: (m) => m.phone ?? "" },
  { header: "Date de naissance", value: (m) => (m.birthdate ? m.birthdate.toISOString().slice(0, 10) : "") },
  { header: "Ville", value: (m) => m.town ?? "" },
  { header: "Adresse", value: (m) => m.address ?? "" },
  { header: "Code postal", value: (m) => m.zip ?? "" },
];

/** Échappe une cellule CSV (RFC 4180) : entoure de guillemets dès qu'elle contient une virgule, un guillemet ou un retour à la ligne. */
function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Export CSV de l'effectif (demande explicite 2026-09-14) — un fichier que le staff peut ouvrir dans Excel/Calc. */
export function buildAfpMembersCsv(members: AfpMember[]): string {
  const header = CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(",");
  const rows = members.map((m) => CSV_COLUMNS.map((c) => escapeCsvCell(c.value(m))).join(","));
  // BOM UTF-8 : Excel sur Windows n'affiche correctement les accents sans lui.
  return "﻿" + [header, ...rows].join("\r\n");
}
