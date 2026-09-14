import type { AfpMember } from "@prisma/client";

/** Lecture défensive d'un champ scalaire dans un blob JSON de forme inconnue à l'avance. */
function readString(obj: unknown, key: string): string {
  if (!obj || typeof obj !== "object") return "";
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const CSV_COLUMNS: Array<{ header: string; value: (m: AfpMember) => string }> = [
  { header: "N° AFPadel", value: (m) => String(m.afpPlayerId) },
  { header: "Nom", value: (m) => m.fullName },
  { header: "Catégorie", value: (m) => m.category ?? "" },
  { header: "Sexe", value: (m) => m.gender ?? "" },
  { header: "Points", value: (m) => (m.points !== null ? String(m.points) : "") },
  { header: "Club", value: (m) => readString(m.rawListData, "club_name") },
  { header: "Âge/catégorie", value: (m) => readString(m.rawListData, "age_category") },
  { header: "Nationalité", value: (m) => readString(m.rawListData, "nationality") },
  { header: "Email", value: (m) => readString(m.rawPlayerData, "email") },
  { header: "Téléphone", value: (m) => readString(m.rawPlayerData, "phone") },
  { header: "Date de naissance", value: (m) => readString(m.rawPlayerData, "birthdate") },
  { header: "Ville", value: (m) => readString(m.rawPlayerData, "town") },
  { header: "Adresse", value: (m) => readString(m.rawPlayerData, "address") },
  { header: "Code postal", value: (m) => readString(m.rawPlayerData, "zip") },
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
