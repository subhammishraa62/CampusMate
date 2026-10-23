"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase/config";

export default function AuthPage() {
  const router = useRouter();
  const configured = Boolean(getSupabaseConfig());
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setCurrentEmail(data.user?.email ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setCurrentEmail(session?.user.email ?? null);
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [configured]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage(""); setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: displayName.trim() || email.split("@")[0] } },
        });
        if (authError) throw authError;
        if (!data.session) {
          setMessage("Account created. Check your email for the confirmation link, then sign in here.");
        } else {
          router.replace("/"); router.refresh();
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        router.replace("/"); router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed. Check your details and try again.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    try { await createClient().auth.signOut(); setCurrentEmail(null); setMessage("Signed out. Your local demo tasks stay on this device."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out."); }
  }

  return <main className="auth-shell">
    <div className="auth-atmosphere" aria-hidden="true" />
    <div className="auth-topline"><Link className="auth-brand" href="/">campus<span>mate</span></Link><span>YOUR DAY, YOUR WAY</span></div>
    <section className="auth-panel">
      <span className="section-overline">CAMPUSMATE / YOUR SPACE</span>
      <h1>{currentEmail ? <>Your space,<br/><em>kept in sync.</em></> : mode === "signin" ? <>Welcome<br/><em>back.</em></> : <>A little room<br/><em>to begin.</em></>}</h1>
      {currentEmail ? <>
        <p className="auth-intro">Signed in as <strong>{currentEmail}</strong>. Your tasks can sync across sessions when Supabase is configured.</p>
        {message && <div className="auth-message" role="status">{message}</div>}{error && <div className="auth-error" role="alert">{error}</div>}
        <div className="auth-actions"><Link className="auth-primary" href="/">Return to CampusMate <span>↗</span></Link><button className="auth-secondary" type="button" onClick={signOut}>Sign out</button></div>
      </> : !configured ? <>
        <p className="auth-intro">Account and cloud sync are ready to connect, but this local project has no Supabase credentials yet. You can keep using the local demo in the meantime.</p>
        <div className="auth-setup-note"><strong>Setup needed</strong><span>Copy <code>.env.example</code> to <code>.env.local</code>, then add your Supabase project URL and publishable key. The setup guide explains the rest.</span></div>
        <Link className="auth-primary" href="/">Continue in local mode <span>↗</span></Link>
      </> : <>
        <p className="auth-intro">Sign in to keep your planner attached to your account, not just this browser.</p>
        <div className="auth-tabs"><button className={mode === "signin" ? "selected" : ""} onClick={() => { setMode("signin"); setError(""); setMessage(""); }} type="button">SIGN IN</button><button className={mode === "signup" ? "selected" : ""} onClick={() => { setMode("signup"); setError(""); setMessage(""); }} type="button">CREATE ACCOUNT</button></div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && <label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="What should CampusMate call you?" maxLength={80}/></label>}
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@college.edu"/></label>
          <label>Password<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters"/></label>
          {error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-message" role="status">{message}</div>}
          <button className="auth-primary" disabled={busy} type="submit">{busy ? "PLEASE WAIT…" : mode === "signin" ? "Sign in to my space" : "Create my account"}<span>↗</span></button>
        </form>
        <p className="auth-smallprint">Your planner stays private. Each account can only access its own records.</p>
      </>}
    </section>
    <div className="auth-bottom"><span>MADE FOR THE SHAPE OF STUDENT LIFE</span><span>One thing at a time.</span></div>
  </main>;
}
