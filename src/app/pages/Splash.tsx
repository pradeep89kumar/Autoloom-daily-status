import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

type Quote = {
  ta: string;
  translit: string;
  en: string;
  by: string;
};

const QUOTES: Quote[] = [
  {
    ta: "யாதும் ஊரே, யாவரும் கேளிர்",
    translit: "Yaadhum oorae, yaavarum kelir",
    en: "Every town is ours, everyone is kin.",
    by: "Kaniyan Pungundranar",
  },
  {
    ta: "உழுதுண்டு வாழ்வாரே வாழ்வார்",
    translit: "Uzhudhundu vaazhvaarae vaazhvaar",
    en: "Those who live by their own labour, truly live.",
    by: "Thiruvalluvar",
  },
  {
    ta: "செயற்கரிய செய்வார் பெரியர்",
    translit: "Seyatkariya seyvaar periyar",
    en: "The great are those who do the difficult.",
    by: "Thiruvalluvar",
  },
  {
    ta: "கற்றது கைமண் அளவு, கல்லாதது உலகளவு",
    translit: "Katradhu kaiman alavu, kallaadhadhu ulagalavu",
    en: "What we have learnt is a handful; what we haven't is the world.",
    by: "Avvaiyar",
  },
  {
    ta: "நிற்க அதற்குத் தக",
    translit: "Nirka adharkuth thaga",
    en: "Stand worthy of what you stand for.",
    by: "Avvaiyar",
  },
  {
    ta: "வெல்லும் சொல் இனிய சொல்",
    translit: "Vellum sol iniya sol",
    en: "The winning word is the kind word.",
    by: "Thiruvalluvar",
  },
  {
    ta: "முயற்சி திருவினை ஆக்கும்",
    translit: "Muyarchi thiruvinai aakkum",
    en: "Steady effort turns toil into fortune.",
    by: "Thiruvalluvar",
  },
  {
    ta: "காலம் செய்யும் கைம்மாறு",
    translit: "Kaalam seyyum kaimmaaru",
    en: "Time itself returns the favour.",
    by: "Tamil proverb",
  },
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
        <p className="mt-2 text-[13px] italic text-[var(--color-text-secondary)]">
          {quote.translit}
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-text-primary)]">
          &ldquo;{quote.en}&rdquo;
        </p>
        <p className="mt-2 text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)]">
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
