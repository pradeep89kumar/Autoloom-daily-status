import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

type Quote = { ta: string; by: string };

const QUOTES: Quote[] = [
  // Thirumoolar — Thirumandiram
  { ta: "அன்பும் சிவமும் இரண்டென்பர் அறிவிலார்", by: "திருமூலர்" },
  { ta: "ஒன்றே குலம், ஒருவனே தேவன்", by: "திருமூலர்" },
  { ta: "உள்ளம் பெருங்கோயில் ஊனுடம்பு ஆலயம்", by: "திருமூலர்" },
  { ta: "நாடும் பொருளும் நலமும் அவையெல்லாம் தேடும் தனக்கொரு தெய்வம் அவன்காண்", by: "திருமூலர்" },

  // Avvaiyar — Aathichudi & Konrai Vendhan
  { ta: "அறம் செய விரும்பு", by: "ஔவையார்" },
  { ta: "ஆறுவது சினம்", by: "ஔவையார்" },
  { ta: "இயல்வது கரவேல்", by: "ஔவையார்" },
  { ta: "ஈவது விலக்கேல்", by: "ஔவையார்" },
  { ta: "உடையது விளம்பேல்", by: "ஔவையார்" },
  { ta: "கற்றது கைம்மண் அளவு, கல்லாதது உலகளவு", by: "ஔவையார்" },
  { ta: "நிற்க அதற்குத் தக", by: "ஔவையார்" },

  // Thiruvalluvar — Thirukkural
  { ta: "முயற்சி திருவினை ஆக்கும்; முயற்றின்மை இன்மை புகுத்தி விடும்", by: "திருவள்ளுவர்" },
  { ta: "ஊக்கம் உடையான் ஒடுக்கம் பொருத்தக்கால் தாக்கி வீழும் தலை", by: "திருவள்ளுவர்" },
  { ta: "எண்ணிய எண்ணியாங்கு எய்துப", by: "திருவள்ளுவர்" },
  { ta: "தோன்றிற் புகழொடு தோன்றுக; அஃதிலார் தோன்றலின் தோன்றாமை நன்று", by: "திருவள்ளுவர்" },
  { ta: "உழுதுண்டு வாழ்வாரே வாழ்வார்; மற்றெல்லாம் தொழுதுண்டு பின் செல்பவர்", by: "திருவள்ளுவர்" },
  { ta: "செயற்கரிய செய்வார் பெரியர்; சிறியர் செயற்கரிய செய்கலாதார்", by: "திருவள்ளுவர்" },
  { ta: "கற்க கசடறக் கற்பவை; கற்றபின் நிற்க அதற்குத் தக", by: "திருவள்ளுவர்" },
  { ta: "இன்னா செய்தாரை ஒறுத்தல் அவர் நாண நன்னயம் செய்து விடல்", by: "திருவள்ளுவர்" },
  { ta: "வெள்ளத்து அனைய மலர் நீட்டம், மாந்தர்தம் உள்ளத்து அனையது உயர்வு", by: "திருவள்ளுவர்" },

  // Sangam — Purananuru
  { ta: "யாதும் ஊரே, யாவரும் கேளிர்", by: "கணியன் பூங்குன்றனார்" },
  { ta: "தீதும் நன்றும் பிறர் தர வாரா", by: "கணியன் பூங்குன்றனார்" },

  // Naladiyar
  { ta: "மழித்தலும் நீட்டலும் வேண்டா; உலகம் பழித்தது ஒழித்து விடின்", by: "நாலடியார்" },

  // Pattinathar
  { ta: "கற்பகத் தருநிழல் கைவிட்டு வாழ்வது, விற்பனை செய்யும் வீண்வாழ்வே", by: "பட்டினத்தார்" },

  // Bharathiyar
  { ta: "தனி ஒருவனுக்கு உணவில்லை எனில் ஜகத்தினை அழித்திடுவோம்", by: "பாரதியார்" },
  { ta: "காக்கைக் குருவி எங்கள் ஜாதி, நீள் கடலும் மலையும் எங்கள் கூட்டம்", by: "பாரதியார்" },
  { ta: "அச்சமில்லை அச்சமில்லை அச்சமென்பதில்லையே", by: "பாரதியார்" },

  // Bharathidasan
  { ta: "உழைப்பவர்க்கே சோறு, உழையாதவர்க்கு இல்லை", by: "பாரதிதாசன்" },
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
