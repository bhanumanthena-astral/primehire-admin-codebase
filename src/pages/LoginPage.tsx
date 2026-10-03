import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/authContext';
import { Globe, KeyRound, Loader2, ArrowRight } from 'lucide-react';
import './EliteHrLogin.css';

/* ── Brand icons ── */
const GoogleIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2 3.8-5 3.8-8.7z" />
    <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-3.7 2.9-.1.1C3.5 21.5 7.5 24 12 24z" />
    <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-.1-.1-3.6-2.8-.1.1C.5 8.7 0 10.2 0 12s.5 3.3 1.4 4.7l3.8-2.3z" />
    <path fill="#EA4335" d="M12 4.6c1.8 0 3 .8 3.7 1.4l3.3-3.2.1-.1C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.5 1.4 6.7l3.8 2.9c1-2.9 3.7-5 6.8-5z" />
  </svg>
);

const AppleIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.36 12.76c0-2.3 1.88-3.4 1.97-3.45-1.07-1.57-2.74-1.78-3.34-1.8-1.42-.15-2.77.83-3.49.83-.72 0-1.83-.81-3.01-.79-1.55.02-2.97.9-3.77 2.28-1.61 2.79-.41 6.93 1.16 9.2.76 1.1 1.67 2.34 2.87 2.29 1.15-.05 1.58-.74 2.97-.74s1.78.74 3 .72c1.24-.02 2.02-1.12 2.78-2.23.87-1.27 1.23-2.51 1.25-2.57-.03-.01-2.4-.92-2.42-3.74zM14.16 4.06c.64-.77 1.07-1.85.95-2.92-.92.04-2.03.61-2.69 1.38-.59.68-1.11 1.77-.97 2.82 1.02.08 2.07-.52 2.71-1.28z" />
  </svg>
);

const FacebookIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
    <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.09 24 18.1 24 12.07z" />
  </svg>
);

const Squiggle: React.FC<{ className?: string; flip?: boolean; width?: number }> = ({
  className = '',
  flip = false,
  width = 104,
}) => (
  <svg
    className={className}
    width={width}
    height="26"
    viewBox="0 0 120 32"
    fill="none"
    aria-hidden="true"
    style={flip ? { transform: 'scaleX(-1)' } : undefined}
  >
    <path
      className="elite-squiggle"
      d="M4 24 C 14 24, 12 6, 24 12 C 36 18, 30 28, 42 22 C 52 17, 52 4, 62 10 C 72 16, 70 26, 84 20 C 94 16, 100 12, 116 14"
    />
  </svg>
);

/* ── LEFT column: squiggle / dot / speech box / dotted block + arrow ──
   Fixed 210px wide, 440px tall; bottoms sit on the shared stage ground line. */
const LeftDecor: React.FC = () => (
  <div aria-hidden="true" className="elite-col-side elite-anim-side hidden w-[210px] shrink-0 lg:block">
    <div className="relative h-[440px]">
      <Squiggle className="elite-float absolute left-10 top-0" width={96} />
      <div className="elite-float-slow absolute right-4 top-[2px] h-[7px] w-[7px] rounded-full border border-[#201a15]/50" />

      <div className="elite-float-x absolute left-[38px] top-[74px]">
        <div className="h-[78px] w-[104px] border border-[#201a15]/70 bg-[#ece5d3]">
          <div className="mx-auto mt-[18px] h-px w-[64px] bg-[#201a15]/60" />
          <div className="mx-auto mt-[10px] h-px w-[42px] bg-[#201a15]/50" />
        </div>
        <div className="ml-[22px] h-[26px] w-[26px] border-b border-r border-[#e8c98a]" />
      </div>
      <div className="elite-float absolute right-[38px] top-[168px] h-3 w-3 rounded-full border border-[#201a15]/50" />

      <div className="absolute bottom-[52px] left-[24px] flex items-end">
        <div className="elite-float-slow relative h-[128px] w-[66px] overflow-hidden bg-[#fbe09a]">
          <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
            {[
              [13, 12], [36, 9], [48, 26], [20, 35], [40, 48], [11, 57],
              [31, 68], [49, 77], [15, 86], [37, 96], [52, 106], [18, 114],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="3.6" fill="#201a15" />
            ))}
          </svg>
        </div>
        <div className="elite-float ml-[6px] flex h-[86px] w-[66px] items-center justify-center border border-[#201a15]/70 bg-white">
          <svg width="34" height="52" viewBox="0 0 40 56" fill="none" aria-hidden="true">
            <path d="M20 52 C 22 40, 26 28, 34 12 M27 14 L34 10 L36 18" stroke="#201a15" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      <Squiggle className="absolute bottom-[128px] left-[150px]" width={64} />
    </div>
  </div>
);

/* ── RIGHT column: girl with her own breathing room (320px, fully visible) ── */
const GirlIllustration: React.FC = () => (
  <div aria-hidden="true" className="elite-col-side elite-anim-side hidden w-[320px] shrink-0 lg:block">
    <div className="relative h-[440px]">
      <Squiggle className="elite-float absolute right-2 top-0" width={96} flip />
      <div className="elite-float-slow elite-delay-1 absolute right-0 top-[30px] h-[7px] w-[7px] rounded-full border border-[#201a15]/50" />

      <svg viewBox="0 0 360 400" className="absolute bottom-[52px] left-0 h-[388px] w-[320px]" role="presentation">
        <defs>
          <pattern id="elite-dots" width="17" height="17" patternUnits="userSpaceOnUse">
            <circle cx="6" cy="6" r="3.1" fill="#201a15" />
          </pattern>
        </defs>

        {/* top-left hand-drawn curl */}
        <path className="elite-squiggle elite-float" d="M8 24 C 13 24, 11 12, 19 14 C 26 16, 22 24, 30 22" />

        {/* message box with pale tail */}
        <g className="elite-float-x">
          <rect x="52" y="30" width="58" height="40" fill="#f4efe7" stroke="#201a15" strokeWidth="1.1" />
          <line x1="63" y1="45" x2="99" y2="45" stroke="#201a15" strokeWidth="1" />
          <line x1="68" y1="56" x2="94" y2="56" stroke="#201a15" strokeWidth="0.9" />
          <polygon points="66,70 80,70 66,86" fill="#f7d98b" opacity="0.7" />
        </g>

        {/* right-side squiggle + dot */}
        <path className="elite-squiggle elite-float elite-delay-1" d="M232 128 C 242 128, 240 112, 250 117 C 260 122, 256 132, 268 127 C 278 123, 284 119, 296 121" />
        <circle cx="322" cy="112" r="3" fill="none" stroke="#201a15" strokeWidth="1" opacity="0.6" className="elite-float-slow" />

        {/* faint yellow diagonal + small ring near laptop */}
        <line x1="28" y1="222" x2="52" y2="262" stroke="#f2d98c" strokeWidth="1.4" opacity="0.7" />
        <circle cx="34" cy="252" r="2.6" fill="none" stroke="#201a15" strokeWidth="1" opacity="0.55" className="elite-float" />

        {/* yellow dotted block (right of pedestal, shared ground) */}
        <g className="elite-float-slow">
          <rect x="216" y="246" width="60" height="102" fill="#fbe09a" />
          <rect x="216" y="246" width="60" height="102" fill="url(#elite-dots)" />
        </g>

        {/* pedestal she sits on */}
        <rect x="118" y="213" width="92" height="135" fill="#ffffff" stroke="#201a15" strokeWidth="1.4" />
        <ellipse cx="164" cy="350" rx="44" ry="4" fill="#201a15" opacity="0.06" />

        {/* laptop — resting on her lap, deck directly under her hands */}
        <g>
          <polygon points="50,138 63,141 92,196 79,194" fill="#c6cf7e" stroke="#201a15" strokeWidth="1.2" strokeLinejoin="round" />
          <polygon points="79,194 92,196 162,187 149,180" fill="#bcc46e" stroke="#201a15" strokeWidth="1.2" strokeLinejoin="round" />
          <line x1="100" y1="190" x2="148" y2="185" stroke="#201a15" strokeWidth="0.9" opacity="0.4" strokeLinecap="round" />
        </g>

        {/* girl */}
        <g className="elite-breathe">
          {/* back leg */}
          <g>
            <path d="M166 214 C 140 220, 116 232, 106 252 L 110 316" fill="none" stroke="#201a15" strokeWidth="25" strokeLinecap="round" />
            <path d="M166 214 C 140 220, 116 232, 106 252 L 110 316" fill="none" stroke="#ffffff" strokeWidth="19" strokeLinecap="round" />
          </g>
          {/* front leg */}
          <g>
            <path d="M154 210 C 122 214, 94 226, 82 248 L 56 320" fill="none" stroke="#201a15" strokeWidth="26" strokeLinecap="round" />
            <path d="M154 210 C 122 214, 94 226, 82 248 L 56 320" fill="none" stroke="#ffffff" strokeWidth="20" strokeLinecap="round" />
          </g>
          {/* chunky black shoes, toes pointing left */}
          <g fill="#141414">
            <path d="M36 321 L60 321 Q68 321 66 329 Q64 336 54 336 L44 336 Q34 336 34 328 Z" />
            <path d="M90 319 L114 319 Q122 319 120 327 Q118 334 108 334 L98 334 Q88 334 88 326 Z" />
          </g>

          {/* black top with white dash print */}
          <g>
            <path
              d="M148 212 L 160 142 Q 163 128, 177 126 L 197 128 Q 208 130, 210 144 L 216 212 Q 182 220, 148 212 Z"
              fill="#141414"
              stroke="#141414"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <g stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" opacity="0.9">
              <line x1="168" y1="142" x2="173" y2="144" />
              <line x1="184" y1="138" x2="189" y2="140" />
              <line x1="196" y1="148" x2="201" y2="150" />
              <line x1="172" y1="156" x2="177" y2="158" />
              <line x1="188" y1="158" x2="193" y2="160" />
              <line x1="200" y1="168" x2="204" y2="172" />
              <line x1="166" y1="172" x2="171" y2="174" />
              <line x1="182" y1="176" x2="187" y2="178" />
              <line x1="196" y1="184" x2="201" y2="186" />
              <line x1="172" y1="192" x2="177" y2="194" />
              <line x1="188" y1="196" x2="193" y2="198" />
              <line x1="202" y1="198" x2="206" y2="200" />
            </g>
          </g>
          {/* short sleeves where the arms exit */}
          <circle cx="186" cy="142" r="10" fill="#141414" />
          <circle cx="190" cy="153" r="9.5" fill="#141414" />

          <g className="elite-arm-a">
            <path d="M188 144 C 164 154, 132 166, 102 180" fill="none" stroke="#201a15" strokeWidth="13" strokeLinecap="round" />
            <path d="M188 144 C 164 154, 132 166, 102 180" fill="none" stroke="#ffffff" strokeWidth="9.5" strokeLinecap="round" />
            <g>
              <ellipse cx="95" cy="181" rx="8" ry="5" fill="#ffffff" stroke="#201a15" strokeWidth="1.1" transform="rotate(-12 95 181)" />
              <line x1="95" y1="183" x2="106" y2="186.5" stroke="#201a15" strokeWidth="1" strokeLinecap="round" />
              <line x1="94" y1="185.5" x2="105" y2="189" stroke="#201a15" strokeWidth="1" strokeLinecap="round" />
            </g>
          </g>
          <g className="elite-arm-b">
            <path d="M192 154 C 170 164, 140 176, 110 188" fill="none" stroke="#201a15" strokeWidth="12" strokeLinecap="round" />
            <path d="M192 154 C 170 164, 140 176, 110 188" fill="none" stroke="#ffffff" strokeWidth="8.5" strokeLinecap="round" />
            <g>
              <ellipse cx="103" cy="187" rx="7" ry="4.5" fill="#ffffff" stroke="#201a15" strokeWidth="1.1" transform="rotate(-10 103 187)" />
              <line x1="103" y1="189" x2="113" y2="192" stroke="#201a15" strokeWidth="1" strokeLinecap="round" />
            </g>
          </g>

          <g className="elite-head-move">
            <g className="elite-hair-move">
              {/* sleek tail flowing back, tapered */}
              <path
                d="M186 72 Q 208 74, 226 88 Q 240 99, 234 107 Q 226 112, 216 105 Q 203 96, 189 91 Z"
                fill="#141414"
              />
              {/* bun */}
              <circle cx="190" cy="63" r="6.5" fill="#141414" />
              {/* cap hugging the skull */}
              <path
                d="M157 90 Q 155 71, 173 66 Q 189 62, 198 74 Q 202 81, 200 88 Q 192 78, 179 78 Q 165 78, 157 90 Z"
                fill="#141414"
              />
            </g>
            <rect x="178" y="106" width="9" height="18" fill="#ffffff" stroke="#201a15" strokeWidth="1.1" />
            <g>
              {/* slim face in profile, gaze down at the laptop */}
              <ellipse cx="172" cy="92" rx="13.5" ry="15" fill="#ffffff" stroke="#201a15" strokeWidth="1.2" />
              {/* nose hint on the profile edge */}
              <path d="M158.5 94 Q 156.5 97.5, 158.5 100" fill="none" stroke="#201a15" strokeWidth="1.1" strokeLinecap="round" />
              {/* closed lash eye */}
              <path d="M160 92.5 Q 164 96, 169 94" fill="none" stroke="#201a15" strokeWidth="1.2" strokeLinecap="round" />
              {/* brow */}
              <path d="M161 86.5 Q 164.5 85.5, 168 86.5" fill="none" stroke="#201a15" strokeWidth="0.9" strokeLinecap="round" />
              {/* small mouth */}
              <path d="M160.5 104.5 Q 163 106, 166 105" fill="none" stroke="#201a15" strokeWidth="1" strokeLinecap="round" />
              {/* ear */}
              <path d="M183 93.5 Q 185.5 96, 183 99.5" fill="none" stroke="#201a15" strokeWidth="1" strokeLinecap="round" />
            </g>
          </g>
        </g>

        <circle cx="66" cy="240" r="2.6" fill="none" stroke="#201a15" strokeWidth="1" opacity="0.55" className="elite-float" />
      </svg>
    </div>
  </div>
);

function validateIdentity(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Please enter your email or phone number.';
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const digits = v.replace(/\D/g, '');
  const isPhone = digits.length >= 7 && digits.length <= 15;
  if (!isEmail && !isPhone) return 'Enter a valid email address or phone number.';
  return null;
}

export const LoginPage: React.FC = () => {
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/';

  const [identity, setIdentity] = useState('');
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const idErr = validateIdentity(identity);
    const pcErr = passcode ? null : 'Please enter your passcode.';
    setIdentityError(idErr);
    setPasscodeError(pcErr);
    setFormError(null);
    if (idErr || pcErr) return;

    setLoading(true);
    try {
      const result = await login(identity.trim(), passcode);
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
      } else {
        navigate(from, { replace: true });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed. Please check your credentials.';
      setFormError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    if (!mfaCode.trim()) {
      setMfaError('Please enter your verification code.');
      return;
    }
    setMfaError(null);
    setFormError(null);
    setLoading(true);
    try {
      await verifyMfa(mfaToken, mfaCode.trim());
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid verification code. Please try again.';
      setMfaError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="elite-page relative flex min-h-screen flex-col overflow-hidden">
      {/* ── Top bar on the shared 1080 grid ── */}
      <header className="elite-anim-header relative z-20 mx-auto flex w-full max-w-[1080px] items-start justify-between px-8 pt-6">
        <div>
          <div className="text-[19px] font-extrabold leading-none tracking-tight">Elite HR</div>
          <div className="mt-[10px] h-px w-[104px] bg-[#201a15]/60" />
          <a
            href="mailto:HR@EliteHR.com"
            className="mt-[7px] inline-flex items-center gap-2 text-[10.5px] font-medium text-[#201a15]/70 transition-colors hover:text-[#201a15]"
          >
            HR@EliteHR.com
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <nav aria-label="Top" className="flex items-center gap-6 pt-[2px]">
          <Globe className="h-[19px] w-[19px] text-[#201a15]/80" strokeWidth={1.3} aria-label="Language" />
          <a href="/login" className="text-[12.5px] font-semibold text-[#201a15]/85 transition-colors hover:text-black">
            Sign up
          </a>
          <a
            href="#demo"
            className="elite-btn-primary rounded-[7px] px-4 py-[9px] text-[12.5px] font-bold leading-none"
          >
            Request Demo
          </a>
        </nav>
      </header>

      {/* ── One composed stage: LEFT | CARD | GIRL ── */}
      <main className="relative z-10 mx-auto flex w-full max-w-[1080px] flex-1 items-center justify-center px-8 pb-2 pt-4">
        <div className="elite-stage">
          <div className="elite-ground hidden lg:block" aria-hidden="true" />
          <LeftDecor />

          <section
            aria-labelledby="elite-login-heading"
            className="elite-card elite-anim-card relative z-10 w-[calc(100vw-64px)] max-w-[430px] shrink-0 px-8 py-8"
          >
            {!mfaToken ? (
              <div className="elite-stagger">
                <div>
                  <h1 id="elite-login-heading" className="text-center text-[22px] font-bold tracking-[-0.02em]">
                    Elite HR Login
                  </h1>
                  <p className="mt-2 text-center text-[12.5px] font-normal leading-[1.6] text-[#6b6459]">
                    Hey, Enter your details to get sign in
                    <br />
                    to your account
                  </p>
                </div>

                {formError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-[12px] font-medium text-red-700"
                  >
                    {formError}
                  </div>
                )}

                <form onSubmit={handleCredentialsSubmit} noValidate className="mt-1 space-y-[10px]">
                  <div>
                    <label htmlFor="elite-identity" className="sr-only">
                      Email or phone number
                    </label>
                    <div className="relative">
                      <input
                        id="elite-identity"
                        name="identity"
                        type="text"
                        autoComplete="username"
                        placeholder="Enter Email / Phone No"
                        value={identity}
                        onChange={(e) => {
                          setIdentity(e.target.value);
                          if (identityError) setIdentityError(null);
                        }}
                        aria-invalid={!!identityError}
                        aria-describedby={identityError ? 'elite-identity-error' : undefined}
                        className={`elite-input h-11 w-full pl-[14px] pr-10 text-[13px] text-[#201a15] ${identityError ? 'elite-input-error' : ''}`}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute right-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full border border-[#d8cfb8]"
                      />
                    </div>
                    {identityError && (
                      <p id="elite-identity-error" role="alert" className="mt-1 text-[11.5px] font-medium text-red-600">
                        {identityError}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="elite-passcode" className="sr-only">
                      Passcode
                    </label>
                    <div className="relative">
                      <input
                        id="elite-passcode"
                        name="password"
                        type={showPasscode ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="Passcode"
                        value={passcode}
                        onChange={(e) => {
                          setPasscode(e.target.value);
                          if (passcodeError) setPasscodeError(null);
                        }}
                        aria-invalid={!!passcodeError}
                        aria-describedby={passcodeError ? 'elite-passcode-error' : undefined}
                        className={`elite-input h-11 w-full pl-[14px] pr-[60px] text-[13px] text-[#201a15] ${passcodeError ? 'elite-input-error' : ''}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasscode((s) => !s)}
                        aria-pressed={showPasscode}
                        aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
                        className="absolute right-[14px] top-1/2 -translate-y-1/2 cursor-pointer text-[11px] font-bold text-[#201a15]/60 transition-colors hover:text-black"
                      >
                        {showPasscode ? 'Show' : 'Hide'}
                      </button>
                    </div>
                    {passcodeError && (
                      <p id="elite-passcode-error" role="alert" className="mt-1 text-[11.5px] font-medium text-red-600">
                        {passcodeError}
                      </p>
                    )}
                  </div>

                  <div className="pt-[2px]">
                    <button
                      type="button"
                      className="cursor-pointer text-[11.5px] font-semibold text-[#201a15]/80 transition-colors hover:text-black"
                    >
                      Having trouble in sign in?
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="elite-btn-primary flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg text-[13.5px] font-bold"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="elite-spin h-4 w-4" aria-hidden="true" />
                        <span>Signing in…</span>
                      </>
                    ) : (
                      <span>Sign in</span>
                    )}
                  </button>
                </form>

                <div className="mt-[18px] flex items-center justify-center gap-2 text-[11px] font-semibold text-[#201a15]">
                  <span aria-hidden="true" className="h-px w-[18px] bg-[#201a15]/60" />
                  <span>Or Sign in with</span>
                  <span aria-hidden="true" className="h-px w-[18px] bg-[#201a15]/60" />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    aria-label="Sign in with Google"
                    className="elite-btn-social flex h-[38px] cursor-pointer items-center justify-center gap-1.5 text-[11.5px] font-bold"
                  >
                    <GoogleIcon />
                    Google
                  </button>
                  <button
                    type="button"
                    aria-label="Sign in with Apple ID"
                    className="elite-btn-social flex h-[38px] cursor-pointer items-center justify-center gap-1.5 text-[11.5px] font-bold"
                  >
                    <AppleIcon />
                    Apple ID
                  </button>
                  <button
                    type="button"
                    aria-label="Sign in with Facebook"
                    className="elite-btn-social flex h-[38px] cursor-pointer items-center justify-center gap-1.5 text-[11.5px] font-bold"
                  >
                    <FacebookIcon />
                    Facebook
                  </button>
                </div>

                <p className="mt-[18px] text-center text-[11.5px] text-[#201a15]/75">
                  Don&apos;t have an account?{' '}
                  <a href="#request" className="font-bold text-[#201a15] underline-offset-2 transition-colors hover:underline">
                    Request Now
                  </a>
                </p>
              </div>
            ) : (
              <div className="elite-stagger">
                <div className="text-center">
                  <KeyRound className="mx-auto mb-2 h-7 w-7 text-[#201a15]" aria-hidden="true" />
                  <h1 id="elite-login-heading" className="text-[20px] font-bold tracking-[-0.02em]">
                    Two-Factor Authentication
                  </h1>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[#6b6459]">
                    Enter the 6-digit code from your authenticator
                    <br />
                    app or an 8-character recovery code.
                  </p>
                </div>
                {mfaError && (
                  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-[12px] font-medium text-red-700">
                    {mfaError}
                  </div>
                )}
                <form onSubmit={handleMfaSubmit} className="space-y-[10px]">
                  <div>
                    <label htmlFor="elite-mfa" className="sr-only">
                      Verification code
                    </label>
                    <input
                      id="elite-mfa"
                      type="text"
                      autoFocus
                      autoComplete="one-time-code"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      placeholder="123456 or XXXX-XXXX"
                      className="elite-input h-11 w-full px-4 text-center font-mono text-[14px] tracking-[0.2em] placeholder:font-sans placeholder:text-[12.5px] placeholder:tracking-normal"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="elite-btn-primary flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg text-[13.5px] font-bold"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="elite-spin h-4 w-4" aria-hidden="true" />
                        <span>Verifying…</span>
                      </>
                    ) : (
                      <>
                        <span>Confirm &amp; Sign In</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMfaToken(null);
                      setMfaCode('');
                      setMfaError(null);
                    }}
                    className="w-full cursor-pointer text-center text-[11.5px] font-medium text-[#201a15]/55 transition-colors hover:text-black"
                  >
                    Back to login
                  </button>
                </form>
              </div>
            )}
          </section>

          <GirlIllustration />
        </div>
      </main>

      <footer className="elite-anim-footer relative z-10 pb-5 text-center text-[10.5px] font-medium text-[#201a15]/55">
        Copyright © Elite HR 2026&nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="#privacy" className="transition-colors hover:text-black hover:underline underline-offset-2">
          Privacy Policy
        </a>
      </footer>
    </div>
  );
};
