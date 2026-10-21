"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type TableStatus = { status: "ok" | "error" | "not_checked"; hint?: string };
type Diagnostics = {
  checkedAt: string;
  supabase: {
    configured: boolean;
    authenticated: boolean;
    authStatus: string;
    tables: Record<string, TableStatus>;
  };
  bedrock: {
    enabled: boolean;
    modelId: string;
    region: string;
    credentialOrInvocationTested: boolean;
    note: string;
  };
  mcp: {
    endpoint: string;
    transport: string;
    sharedTokenConfigured: boolean;
    remoteAlexaPlusReady: boolean;
    note: string;
  };
};

function StatePill({ state, label }: { state: "ok" | "waiting" | "blocked" | "unknown"; label: string }) {
  return <span className={`integration-state state-${state}`}><i aria-hidden="true" />{label}</span>;
}

export default function IntegrationsPage() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/integration-status", { cache: "no-store" });
      const data = await response.json() as Diagnostics & { error?: string };
      if (!response.ok) throw new Error(data.error || `Diagnostics returned ${response.status}.`);
      setDiagnostics(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't read integration status. Check the development server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const tableChecks = diagnostics ? Object.entries(diagnostics.supabase.tables) : [];
  const allTablesOk = tableChecks.length > 0 && tableChecks.every(([, table]) => table.status === "ok");
  const authOk = Boolean(diagnostics?.supabase.authenticated);

  return <main className="integration-shell">
    <div className="resource-atmosphere" aria-hidden="true" />
    <header className="resource-topbar">
      <Link className="resource-brand" href="/">campus<span>mate</span><small>INTEGRATION COMMAND CENTER</small></Link>
      <nav aria-label="Integration navigation"><Link href="/">Today</Link><Link href="/resources">Courses & sessions</Link><Link href="/auth">Account</Link></nav>
    </header>
    <div className="integration-content">
      <div className="resource-breadcrumb"><Link href="/">YOUR SPACE</Link><span>/</span><strong>INTEGRATIONS</strong><i className="resource-live-dot" /></div>
      <section className="integration-hero">
        <div><span className="resource-eyebrow">CAMPUSMATE / SYSTEM CHECK</span><h1>One clear view.<br /><em>No mystery states.</em></h1><p>Read-only checks for your Supabase session and core tables, plus honest readiness notes for Bedrock and Alexa+ MCP. This page never prints credentials or personal database rows.</p></div>
        <button className="integration-refresh" onClick={() => void refresh()} disabled={loading}>{loading ? "CHECKING…" : "↻ RUN CHECKS"}</button>
      </section>
      {error && <div className="integration-error" role="alert">{error}</div>}
      {!diagnostics && !error && <div className="integration-loading">Checking configuration and current session…</div>}
      {diagnostics && <>
        <div className="integration-summary-grid">
          <article className="integration-summary-card"><span className="integration-number">01 / DATA</span><div className="integration-summary-top"><h2>Supabase</h2><StatePill state={!diagnostics.supabase.configured ? "blocked" : authOk && allTablesOk ? "ok" : authOk ? "waiting" : "blocked"} label={!diagnostics.supabase.configured ? "SETUP NEEDED" : authOk && allTablesOk ? "CONNECTED" : authOk ? "CHECK SCHEMA" : "SIGN-IN NEEDED"} /></div><p>{!diagnostics.supabase.configured ? "Project URL and publishable key are not configured in this server." : !authOk ? "Configuration exists, but this browser session is not authenticated. Sign in to check table access." : allTablesOk ? "Authenticated read checks passed for all core tables." : "Your session is active; one or more table checks need attention."}</p><Link href="/auth">Open account ↗</Link></article>
          <article className="integration-summary-card"><span className="integration-number">02 / MODEL</span><div className="integration-summary-top"><h2>Amazon Bedrock</h2><StatePill state={diagnostics.bedrock.enabled ? "waiting" : "blocked"} label={diagnostics.bedrock.enabled ? "CONFIG ENABLED" : "SAFELY DISABLED"} /></div><p>{diagnostics.bedrock.note}</p><dl><div><dt>MODEL ID</dt><dd>{diagnostics.bedrock.modelId}</dd></div><div><dt>REGION</dt><dd>{diagnostics.bedrock.region}</dd></div></dl><code>npm run test:bedrock</code></article>
          <article className="integration-summary-card"><span className="integration-number">03 / VOICE</span><div className="integration-summary-top"><h2>Alexa+ / MCP</h2><StatePill state="waiting" label="LOCAL PROTOCOL" /></div><p>Transport: {diagnostics.mcp.transport}. The local endpoint can be tested independently of Amazon account linking.</p><dl><div><dt>ENDPOINT</dt><dd>{diagnostics.mcp.endpoint}</dd></div><div><dt>SHARED TOKEN</dt><dd>{diagnostics.mcp.sharedTokenConfigured ? "Configured" : "Not configured"}</dd></div></dl><p className="integration-warning">Remote Alexa+ readiness: NOT YET VERIFIED. {diagnostics.mcp.note}</p><a href="https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart" target="_blank" rel="noreferrer">Official Alexa+ MCP checklist ↗</a></article>
        </div>

        <section className="integration-table-panel">
          <div className="integration-panel-heading"><div><span className="resource-eyebrow">READ-ONLY DATABASE CHECKS</span><h2>Supabase table access</h2><p>Checks whether the signed-in session can read the ID column under current permissions/RLS. It does not modify or return row contents.</p></div><StatePill state={!diagnostics.supabase.configured ? "blocked" : !authOk ? "waiting" : allTablesOk ? "ok" : "blocked"} label={!diagnostics.supabase.configured ? "NOT CONFIGURED" : !authOk ? "SIGN IN FIRST" : allTablesOk ? "ALL CHECKS PASSED" : "ACTION REQUIRED"} /></div>
          <div className="integration-table-list">{tableChecks.map(([name, table]) => <div className="integration-table-row" key={name}><div><strong>{name.replaceAll("_", " ")}</strong>{table.hint && <small>{table.hint}</small>}</div><StatePill state={table.status === "ok" ? "ok" : table.status === "error" ? "blocked" : "unknown"} label={table.status === "ok" ? "READ OK" : table.status === "error" ? "CHECK NEEDED" : "NOT CHECKED"} /></div>)}</div>
          {!diagnostics.supabase.configured && <p className="integration-next-step">Next: configure <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in <code>.env.local</code>, then restart the dev server.</p>}
          {diagnostics.supabase.configured && !authOk && <p className="integration-next-step">Next: <Link href="/auth">sign in</Link>, then run checks again. Authentication is different from project configuration.</p>}
          {diagnostics.supabase.configured && authOk && !allTablesOk && <p className="integration-next-step">Next: follow the schema/migration guidance in the v37 START-HERE file. Back up existing data before applying migrations.</p>}
        </section>

        <section className="integration-checklist-panel"><div><span className="resource-eyebrow">THE SHIP CHECKLIST</span><h2>Three systems. Three separate proofs.</h2><p>Don't confuse configuration with a successful live integration. Each one has its own test.</p></div><div className="integration-checklist-grid"><article><b>01</b><strong>Supabase</strong><span>Sign in, create and edit a course/class/task, refresh, then sign out and verify account isolation with a second test account.</span><Link href="/resources">Open learning space ↗</Link></article><article><b>02</b><strong>MCP</strong><span>Start the app, then run <code>npm run verify:mcp</code> in a second terminal. A pass proves local handshake/tool calls only.</span><code>npm run verify:mcp</code></article><article><b>03</b><strong>Bedrock</strong><span>Wait for AWS's quota decision, then run the real Converse test. Keep the model disabled unless that request succeeds.</span><code>npm run test:bedrock</code></article></div></section>
        <footer className="integration-footer"><span>LAST CHECKED {new Date(diagnostics.checkedAt).toLocaleString("en-IN")}</span><span>READ-ONLY DIAGNOSTICS · NO SECRETS EXPOSED</span><Link href="/">Return to CampusMate ↗</Link></footer>
      </>}
    </div>
  </main>;
}
