export const config = { runtime: "edge" };

export default function handler(req: Request) {
  const h = req.headers;
  return new Response(
    JSON.stringify({
      country: h.get("x-vercel-ip-country") ?? "",
      region: h.get("x-vercel-ip-country-region") ?? "",
      city: decodeURIComponent(h.get("x-vercel-ip-city") ?? ""),
      latitude: h.get("x-vercel-ip-latitude") ?? "",
      longitude: h.get("x-vercel-ip-longitude") ?? "",
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
