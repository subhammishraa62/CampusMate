"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase/config";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default function AuthPage() {
  const router = useRouter();
  const configured = Boolean(getSupabaseConfig());
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [course, setCourse] = useState("");
  const [studyYear, setStudyYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);

  const applyUserProfile = useCallback((user: { email?: string; user_metadata?: Record<string, unknown> } | null) => {
    setCurrentEmail(user?.email ?? null);
    const metadata = user?.user_metadata ?? {};
    setDisplayName(
      readString(metadata.display_name) ||
      readString(metadata.full_name) ||
      readString(metadata.name) ||
      user?.email?.split("@")[0] ||
      "",
    );
    setCourse(readString(metadata.course));
    setStudyYear(readString(metadata.study_year));
  }, []);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    const supabase = createClient();

    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (alive && !userError) applyUserProfile(data.user);
    }).catch(() => {
      // Keep the sign-in screen available if the session cannot be loaded.
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) applyUserProfile(session?.user ?? null);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [configured, applyUserProfile]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (mode === "signup" && (!displayName.trim() || !course.trim() || !studyYear.trim())) {
      setError("Please enter your name, course, and year of study.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim(),
              course: course.trim(),
              study_year: studyYear.trim(),
            },
          },
        });
        if (authError) throw authError;
        if (!data.session) {
          setMessage("Account created. Check your email for the confirmation link, then sign in here.");
          setMode("signin");
        } else {
          router.replace("/");
          router.refresh();
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        router.replace("/");
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!displayName.trim() || !course.trim() || !studyYear.trim()) {
      setError("Please enter your name, course, and year of study.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: {
          display_name: displayName.trim(),
          course: course.trim(),
          study_year: studyYear.trim(),
        },
      });
      if (updateError) throw updateError;
      applyUserProfile(data.user);
      setMessage("Profile saved. Return to CampusMate to see your updated details.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setError("");
    setMessage("");
    try {
      const { error: signOutError } = await createClient().auth.signOut();
      if (signOutError) throw signOutError;
      setCurrentEmail(null);
      setDisplayName("");
      setCourse("");
      setStudyYear("");
      setMessage("Signed out. Your local demo tasks stay on this device.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-atmosphere" aria-hidden="true" />
      <div className="auth-topline">
        <Link className="auth-brand" href="/">campus<span>mate</span></Link>
        <span>YOUR DAY, YOUR WAY</span>
      </div>

      <section className="auth-panel">
        <span className="section-overline">CAMPUSMATE / YOUR SPACE</span>
        <h1>
          {currentEmail ? <>Your space,<br /><em>kept in sync.</em></> : mode === "signin" ? <>Welcome<br /><em>back.</em></> : <>A little room<br /><em>to begin.</em></>}
        </h1>

        {currentEmail ? (
          <>
            <p className="auth-intro">Signed in as <strong>{currentEmail}</strong>. Update your student profile here; your dashboard will use these details.</p>
            <form className="auth-form" onSubmit={saveProfile}>
              <label>
                Full name
                <input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Enter your full name" maxLength={80} required />
              </label>
              <label>
                Course
                <input value={course} onChange={(event) => setCourse(event.target.value)} placeholder="e.g. Computer Science Engineering (CSE)" maxLength={80} required />
              </label>
              <label>
                Year of study
                <input value={studyYear} onChange={(event) => setStudyYear(event.target.value)} placeholder="e.g. First Year" maxLength={40} required />
              </label>
              {error && <div className="auth-error" role="alert">{error}</div>}
              {message && <div className="auth-message" role="status">{message}</div>}
              <button className="auth-primary" type="submit" disabled={busy}>{busy ? "SAVING…" : "Save my profile"}<span>↗</span></button>
            </form>
            <div className="auth-actions">
              <Link className="auth-secondary" href="/">Return to CampusMate</Link>
              <button className="auth-secondary" type="button" onClick={signOut}>Sign out</button>
            </div>
          </>
        ) : !configured ? (
          <>
            <p className="auth-intro">Account and cloud sync are ready to connect, but this project has no Supabase credentials configured. You can keep using the local demo in the meantime.</p>
            <div className="auth-setup-note"><strong>Setup needed</strong><span>Copy <code>.env.example</code> to <code>.env.local</code>, then add your Supabase project URL and publishable key. The setup guide explains the rest.</span></div>
            {message && <div className="auth-message" role="status">{message}</div>}
            <Link className="auth-primary" href="/">Continue in local mode <span>↗</span></Link>
          </>
        ) : (
          <>
            <p className="auth-intro">Sign in to keep your planner attached to your account, not just this browser.</p>
            <div className="auth-tabs">
              <button className={mode === "signin" ? "selected" : ""} onClick={() => { setMode("signin"); setError(""); setMessage(""); }} type="button">SIGN IN</button>
              <button className={mode === "signup" ? "selected" : ""} onClick={() => { setMode("signup"); setError(""); setMessage(""); }} type="button">CREATE ACCOUNT</button>
            </div>
            <form className="auth-form" onSubmit={submit}>
              {mode === "signup" && (
                <>
                  <label>
                    Full name
                    <input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Enter your full name" maxLength={80} required />
                  </label>
                  <label>
                    Course
                    <input value={course} onChange={(event) => setCourse(event.target.value)} placeholder="e.g. Computer Science Engineering (CSE)" maxLength={80} required />
                  </label>
                  <label>
                    Year of study
                    <input value={studyYear} onChange={(event) => setStudyYear(event.target.value)} placeholder="e.g. First Year" maxLength={40} required />
                  </label>
                </>
              )}
              <label>
                Email address
                <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@college.edu" />
              </label>
              <label>
                Password
                <input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
              </label>
              {error && <div className="auth-error" role="alert">{error}</div>}
              {message && <div className="auth-message" role="status">{message}</div>}
              <button className="auth-primary" disabled={busy} type="submit">{busy ? "PLEASE WAIT…" : mode === "signin" ? "Sign in to my space" : "Create my account"}<span>↗</span></button>
            </form>
            <p className="auth-smallprint">Your planner stays private. Each account can only access its own records.</p>
          </>
        )}
      </section>
      <div className="auth-bottom"><span>MADE FOR THE SHAPE OF STUDENT LIFE</span><span>One thing at a time.</span></div>
    </main>
  );
}
