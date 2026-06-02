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
  { id: "l1", name: "L1", designName: "Oxford Blue",    customerName: "Sarves",          lastPickK: 184 },
  { id: "l2", name: "L2", designName: "Classic Stripe", customerName: "Vimal Clothing",  lastPickK: 152 },
  { id: "l3", name: "L3", designName: "Emerald Silk",   customerName: "AS Fashions",     lastPickK:  96 },
  { id: "l4", name: "L4", designName: "Winter Heavy",   customerName: "SNSM Textiles",   lastPickK: 211 },
  { id: "l5", name: "L5", designName: "Summer Linen",   customerName: "Global Exports",  lastPickK:  78 },
  { id: "l6", name: "L6", designName: "Navy Suiting",   customerName: "Blue Apparels",   lastPickK: 134 },
  { id: "l7", name: "L7", designName: "Oxford Blue",    customerName: "Dinesh Exports",  lastPickK:   0 },
  { id: "l8", name: "L8", designName: "Check Light",    customerName: "Sarves",          lastPickK: 165 },
];

export function getLoom(id: string): LoomCatalogEntry | undefined {
  return LOOM_CATALOG.find((l) => l.id === id);
}
