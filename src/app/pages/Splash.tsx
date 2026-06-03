import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

type Quote = { ta: string; by: string };

const QUOTES: Quote[] = [
  // சங்க இலக்கியம்
  { ta: "யாதும் ஊரே யாவரும் கேளிர்.", by: "கணியன் பூங்குன்றனார், புறநானூறு" },
  { ta: "தீதும் நன்றும் பிறர்தர வாரா.", by: "கணியன் பூங்குன்றனார், புறநானூறு" },
  { ta: "பெரியோரை வியத்தலும் இலமே; சிறியோரை இகழ்தல் அதனினும் இலமே.", by: "கணியன் பூங்குன்றனார், புறநானூறு" },
  { ta: "உண்டி கொடுத்தோர் உயிர் கொடுத்தோரே.", by: "புறநானூறு" },
  { ta: "நல்லது செய்தல் ஆற்றீராயினும், அல்லது செய்தல் ஓம்புமின்.", by: "நரிவெரூஉத்தலையார், புறநானூறு" },
  { ta: "புகழெனின் உயிரும் கொடுக்குவர்; பழியெனின் உலகுடன் பெறினும் கொள்ளலர்.", by: "புறநானூறு" },
  { ta: "சான்றோர் புகழும் முன்னே செல்வம் பின்னே.", by: "சங்க இலக்கியம்" },
  { ta: "அறிவுடையார் ஆற்றல் அனைத்திற்கும் ஆணி.", by: "சங்க மரபு" },

  // தமிழ் பழமொழிகள்
  { ta: "முயற்சி திருவினை ஆக்கும்.", by: "தமிழ் பழமொழி" },
  { ta: "துளி துளியாகச் சேர்ந்து பெரு வெள்ளம் ஆகும்.", by: "தமிழ் பழமொழி" },
  { ta: "அகல உழுகிறதை விட ஆழ உழு.", by: "தமிழ் பழமொழி" },
  { ta: "செய்வன திருந்தச் செய்.", by: "தமிழ் பழமொழி" },
  { ta: "உண்மை நிலைக்கும்; பொய் அழியும்.", by: "தமிழ் பழமொழி" },
  { ta: "நேர்மை நெடுநாள் நிற்கும்.", by: "தமிழ் பழமொழி" },
  { ta: "கற்றது கைமண் அளவு; கல்லாதது உலகளவு.", by: "தமிழ் பழமொழி" },
  { ta: "உழைத்தவன் உண்ணுவான்.", by: "தமிழ் பழமொழி" },
  { ta: "உழைப்பு உயர்வைத் தரும்.", by: "தமிழ் பழமொழி" },
  { ta: "வேலை பேசட்டும்; வார்த்தை அல்ல.", by: "தமிழ் பழமொழி" },
  { ta: "ஆழம் அறியாமல் கால்விடாதே.", by: "தமிழ் பழமொழி" },
  { ta: "ஆயிரம் முறை அளந்து ஒருமுறை வெட்டு.", by: "தமிழ் பழமொழி" },
  { ta: "நல்ல தொடக்கம் பாதி வெற்றி.", by: "தமிழ் பழமொழி" },
  { ta: "காலம் பொன் போன்றது.", by: "தமிழ் பழமொழி" },
  { ta: "காற்றுள்ள போதே தூற்றிக்கொள்.", by: "தமிழ் பழமொழி" },
  { ta: "கற்றது போதாது; கற்றதைச் சிறப்பாகச் செய்.", by: "தமிழ் மரபு" },
];

const AUTO_DISMISS_MS = 2800;

function longDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function Splash() {
  const navigate = useNavigate();
  const quote = useMemo(
    () => QUOTES[Math.floor(Math.random() * QUOTES.length)],
    [],
  );
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("splash_seen") === "1") {
      navigate("/role", { replace: true });
      return;
    }
    const t = setTimeout(go, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go() {
    if (leaving) return;
    setLeaving(true);
    sessionStorage.setItem("splash_seen", "1");
    setTimeout(() => navigate("/role", { replace: true }), 200);
  }

  return (
    <div
      onClick={go}
      className={`min-h-screen bg-white flex flex-col items-center justify-between px-6 py-10 select-none cursor-pointer transition-opacity duration-200 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(90deg, rgba(31,79,224,0.045) 0 1px, transparent 1px 14px)",
      }}
    >
      <header className="w-full max-w-sm text-center mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--color-text-secondary)]">
          Erode
        </div>
        <h1 className="mt-2 text-[34px] font-bold leading-tight text-[var(--color-text-primary)]">
          Sri Aarumga Tex
        </h1>
        <p className="mt-1 text-[14px] text-[var(--color-text-secondary)]">
          Quality auto-loom weaving
        </p>
      </header>

      <section className="w-full max-w-sm text-center">
        <div
          aria-hidden
          className="mx-auto mb-6 h-px w-16 bg-[var(--color-border-hairline)]"
        />
        <p className="text-[22px] leading-snug font-semibold text-[var(--color-text-primary)]">
          {quote.ta}
        </p>
        <p className="mt-3 text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)]">
          — {quote.by}
        </p>
        <div
          aria-hidden
          className="mx-auto mt-6 h-px w-16 bg-[var(--color-border-hairline)]"
        />
      </section>

      <footer className="w-full max-w-sm text-center mb-2">
        <p className="text-[14px] font-medium text-[var(--color-text-primary)]">
          {longDate(new Date())}
        </p>
        <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
          Tap anywhere to continue
        </p>
      </footer>
    </div>
  );
}
