export interface LoomCatalogEntry {
  id: string;
  name: string;
  /** Design / order name — single field. */
  designName: string;
  customerName: string;
  /** Last known absolute pick counter (in thousands). */
  lastPickK: number;
}

export const LOOM_CATALOG: LoomCatalogEntry[] = [
  { id: "l1",  name: "L1",  designName: "Oxford Blue",    customerName: "Sarves",          lastPickK: 184 },
  { id: "l2",  name: "L2",  designName: "Classic Stripe", customerName: "Vimal Clothing",  lastPickK: 152 },
  { id: "l3",  name: "L3",  designName: "Emerald Silk",   customerName: "AS Fashions",     lastPickK:  96 },
  { id: "l4",  name: "L4",  designName: "Winter Heavy",   customerName: "SNSM Textiles",   lastPickK: 211 },
  { id: "l5",  name: "L5",  designName: "Summer Linen",   customerName: "Global Exports",  lastPickK:  78 },
  { id: "l6",  name: "L6",  designName: "Navy Suiting",   customerName: "Blue Apparels",   lastPickK: 134 },
  { id: "l7",  name: "L7",  designName: "Oxford Blue",    customerName: "Dinesh Exports",  lastPickK:   0 },
  { id: "l8",  name: "L8",  designName: "Check Light",    customerName: "Sarves",          lastPickK: 165 },
  { id: "l9",  name: "L9",  designName: "—",              customerName: "—",                lastPickK:   0 },
  { id: "l10", name: "L10", designName: "—",              customerName: "—",                lastPickK:   0 },
  { id: "l11", name: "L11", designName: "—",              customerName: "—",                lastPickK:   0 },
  { id: "l12", name: "L12", designName: "—",              customerName: "—",                lastPickK:   0 },
  { id: "l13", name: "L13", designName: "—",              customerName: "—",                lastPickK:   0 },
  { id: "l14", name: "L14", designName: "—",              customerName: "—",                lastPickK:   0 },
];

export function getLoom(id: string): LoomCatalogEntry | undefined {
  return LOOM_CATALOG.find((l) => l.id === id);
}
