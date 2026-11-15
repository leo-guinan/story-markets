import { useEffect, useMemo, useState } from 'react';
import { useLinkAccount, usePrivy, useWallets } from '@privy-io/react-auth';
import { downloadWorkspaceExport } from './export.js';

function usageText(value) {
  try {
    const usage = JSON.parse(value || 'null');
    if (!usage || typeof usage !== 'object') return '';
    const parts = [];
    if (Number.isFinite(usage.prompt_tokens)) parts.push(`${usage.prompt_tokens} prompt tokens`);
    if (Number.isFinite(usage.completion_tokens)) parts.push(`${usage.completion_tokens} completion tokens`);
    if (Number.isFinite(usage.cost)) parts.push(`provider-reported $${usage.cost}`);
    return parts.join(' · ');
  } catch { return ''; }
}

async function api(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}`, ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

const PROVIDER_DETAILS = Object.freeze({
  hashference: {
    label: 'Hashference',
    modelPlaceholder: 'Hashference model ID from the live catalog',
  },
  openrouter: {
    label: 'OpenRouter',
    modelPlaceholder: 'OpenRouter model ID, e.g. provider/model',
  },
});

export function ConfigRequired({ message }) {
  return <main className="login-page">
    <header className="nav"><a href="/" className="wordmark">story<span>.</span>markets</a><span className="nav-note">FUTURE RADIO STUDIO / LOCAL SETUP</span></header>
    <section className="login-hero"><div className="eyebrow">Local configuration required</div><h1>Keep the thread.<br/><i>Make the next thing.</i></h1><div className="login-card"><div className="card-kicker">SIGN-IN IS FAIL-CLOSED</div><p className="error-text">{message}</p><p>Set the Privy App ID from the project dashboard in the frontend environment to enable wallet or X login. No demo identity or authentication bypass is enabled.</p></div></section>
    <footer className="footer"><span>FUTURE RADIO × STORY.MARKETS</span><span>Nothing publishes from this room.</span></footer>
  </main>;
}

export function Login() {
  const { ready, login } = usePrivy();
  return <main className="login-page">
    <header className="nav"><a href="/" className="wordmark">story<span>.</span>markets</a><span className="nav-note">FUTURE RADIO STUDIO / PRIVATE BETA</span></header>
    <section className="login-hero">
      <div className="eyebrow">A room for stories still becoming</div>
      <h1>Keep the thread.<br/><i>Make the next thing.</i></h1>
      <p className="intro">Bring a provider key. Choose a Future Radio narrative—or start a private draft of your own. Your writing stays yours until you decide what to share.</p>
      <div className="login-card">
        <div className="card-kicker">YOUR WRITING ROOM</div>
          <p>Sign in with a wallet or X through Privy. To keep one workspace, enter with the identity that already owns it, then link X from Account. A separate Privy identity is not merged automatically. Pelagus compatibility is not yet live-verified.</p>
          <button className="button button-primary" disabled={!ready} onClick={() => login()}>{ready ? 'Sign in with a wallet or X' : 'Preparing sign-in…'} <span>↗</span></button>
          <small>No transaction or token approval is part of sign-in.</small>
      </div>
      <div className="privacy-line"><span className="status-dot"/> PRIVATE DRAFTS · YOUR KEY · YOU INITIATE EVERY GENERATION</div>
    </section>
    <footer className="footer"><span>FUTURE RADIO × STORY.MARKETS</span><span>Nothing publishes from this room.</span></footer>
  </main>;
}

export function findTwitterAccount(user) {
  return user?.linkedAccounts?.find((account) => account?.type === 'twitter_oauth') || null;
}

export function formatXLinkError(error) {
  const message = typeof error === 'string'
    ? error
    : typeof error?.message === 'string' ? error.message : '';
  const normalized = message.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (/linked_to_another_user|already_linked|already_associated|account_already_exists/.test(normalized)
    || /already linked|belongs to another account/.test(message.toLowerCase())) {
    return 'This X account is already linked to another Privy account. That identity and its workspace are not merged or moved automatically.';
  }
  if (/not_enabled|disabled|not_configured|unsupported|provider_unavailable|missing_client/.test(normalized)) {
    return 'X is not enabled for this Privy app. Enable Twitter under Privy Dashboard login methods and verify the OAuth settings.';
  }
  return 'X authentication did not complete. In Privy Dashboard, enable Twitter as a login method and verify its OAuth settings, allowed origins, and callback URL.';
}

function XAccountLink({ user }) {
  const [linkedOverride, setLinkedOverride] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const { linkTwitter } = useLinkAccount({
    onSuccess: ({ linkedAccount }) => {
      if (linkedAccount?.type === 'twitter_oauth') setLinkedOverride(linkedAccount);
      setError('');
    },
    onError: (error) => setError(formatXLinkError(error)),
  });
  const account = linkedOverride || findTwitterAccount(user);

  async function connectX() {
    setConnecting(true);
    setError('');
    try { await linkTwitter(); }
    catch (error) { setError(formatXLinkError(error)); }
    finally { setConnecting(false); }
  }

  const handle = typeof account?.username === 'string' && account.username.trim() ? `@${account.username.trim()}` : '';
  return <section className="panel social-link-panel" aria-labelledby="x-account-heading">
    <div className="step-label">PRIVY PROFILE</div>
    <h2 id="x-account-heading">X account</h2>
    {account
      ? <p className="inline-note" role="status">Connected{handle ? ` as ${handle}` : ''} to this Privy identity. X can be used to sign in.</p>
      : <><p className="panel-intro">Link X to this currently authenticated Privy identity. This keeps the same workspace whether you entered with a wallet or another method. Privy identities and their drafts are not merged automatically.</p><button className="button button-secondary" type="button" onClick={connectX} disabled={connecting}>{connecting ? 'Connecting to X…' : 'Link X account'}</button></>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}

export default function App() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [narratives, setNarratives] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [selectedNarrative, setSelectedNarrative] = useState('');
  const [selectedCredential, setSelectedCredential] = useState('');
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [parentId, setParentId] = useState('');
  const [isMain, setIsMain] = useState(false);
  const [structuralValue, setStructuralValue] = useState('1000000');
  const [childStructuralValue, setChildStructuralValue] = useState('');
  const [structuralLabel, setStructuralLabel] = useState('$1M');
  const [structuralDeadline, setStructuralDeadline] = useState('2026-11-30');
  const [keyLabel, setKeyLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('hashference');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const walletAddress = useMemo(() => wallets?.[0]?.address || user?.wallet?.address || '', [wallets, user]);
  const existingMain = narratives.find((n) => Number(n.is_main) === 1);
  const generationCredential = credentials.find((credential) => credential.id === selectedCredential);
  const generationProvider = generationCredential?.provider || provider;
  const generationProviderDetails = PROVIDER_DETAILS[generationProvider] || PROVIDER_DETAILS.hashference;
  async function token() { const value = await getAccessToken(); if (!value) throw new Error('Your session expired. Sign in again.'); return value; }

  async function refresh() {
    const bearer = await token();
    const [narrativeData, credentialData, generationData] = await Promise.all([
      api('/creator-api/narratives', bearer), api('/creator-api/credentials', bearer), api('/creator-api/generations', bearer),
    ]);
    setNarratives(narrativeData.narratives || []);
    setCredentials(credentialData.credentials || []);
    setGenerations(generationData.generations || []);
    setSelectedNarrative((current) => current || narrativeData.narratives?.[0]?.id || '');
    setSelectedCredential((current) => current || credentialData.credentials?.[0]?.id || '');
  }

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    token().then((bearer) => Promise.all([api('/creator-api/narratives', bearer), api('/creator-api/credentials', bearer), api('/creator-api/generations', bearer)]))
      .then(([n, c, g]) => { if (active) { setNarratives(n.narratives || []); setCredentials(c.credentials || []); setGenerations(g.generations || []); setSelectedNarrative(n.narratives?.[0]?.id || ''); setSelectedCredential(c.credentials?.[0]?.id || ''); } })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [authenticated]);

  async function perform(label, work, success) {
    setBusy(label); setError(''); setNotice('');
    try { await work(); if (success) setNotice(success); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function createNarrative(event) {
    event.preventDefault();
    await perform('narrative', async () => {
      const bearer = await token();
      const result = await api('/creator-api/narratives', bearer, { method: 'POST', body: JSON.stringify({ title, premise, parentId: parentId || null, isMain, structuralValue: isMain ? Number(structuralValue) : parentId && childStructuralValue !== '' ? Number(childStructuralValue) : null, structuralLabel: isMain ? structuralLabel : '', structuralDeadline: isMain ? structuralDeadline : '' }) });
      setNarratives((items) => [result.narrative, ...items]); setSelectedNarrative(result.narrative.id); setTitle(''); setPremise(''); setParentId(''); setIsMain(false);
    }, 'Private narrative draft created.');
  }

  async function saveCredential(event) {
    event.preventDefault();
    await perform('credential', async () => {
      const bearer = await token();
      const result = await api('/creator-api/credentials', bearer, { method: 'POST', body: JSON.stringify({ provider, label: keyLabel, apiKey }) });
      setCredentials((items) => [result.credential, ...items]); setSelectedCredential(result.credential.id); setKeyLabel(''); setApiKey('');
    }, 'Key saved encrypted. It will only be used when you start a generation.');
  }

  async function revokeCredential(id) {
    await perform('revoke', async () => {
      const bearer = await token(); await api(`/creator-api/credentials/${id}`, bearer, { method: 'DELETE' });
      setCredentials((items) => items.filter((item) => item.id !== id)); setSelectedCredential((current) => current === id ? '' : current);
    }, 'Credential revoked and encrypted value removed.');
  }

  async function generate(event) {
    event.preventDefault();
    await perform('generate', async () => {
      const bearer = await token();
      const result = await api('/creator-api/generations', bearer, { method: 'POST', body: JSON.stringify({ narrativeId: selectedNarrative, credentialId: selectedCredential, model, prompt }) });
      setGenerations((items) => [result.generation, ...items]); setPrompt('');
    }, 'Draft generated. It has not been published or approved.');
  }

  async function exportWorkspace() {
    await perform('export', async () => {
      const bearer = await token();
      const data = await api('/creator-api/export', bearer);
      downloadWorkspaceExport(data);
    }, 'Workspace JSON downloaded. It includes your drafts and masked credential metadata, never provider key values.');
  }

  if (!ready) return <main className="loading">Opening the writing room…</main>;
  if (!authenticated) return <Login />;

  return <main className="app-shell">
    <header className="nav"><a href="/" className="wordmark">story<span>.</span>markets</a><div className="nav-right"><span className="nav-note">FUTURE RADIO STUDIO</span><button className="quiet-button" onClick={exportWorkspace} disabled={!!busy} aria-label="Download a JSON export of your workspace">Export data</button><button className="quiet-button" onClick={() => logout()}>Sign out</button></div></header>
    <section className="workspace-head">
      <div><div className="eyebrow">Private workspace · {walletsReady ? 'wallets ready' : 'loading wallet'}</div><h1>Keep the thread.</h1><p>Choose a narrative. Make a draft. Decide later what belongs in the world.</p></div>
      <div className="identity"><span className="status-dot"/> PRIVY SESSION<br/><code>{walletAddress ? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}` : user?.id || 'authenticated'}</code></div>
    </section>
    <div className="rule" />
    {notice && <div className="flash success" role="status">{notice}</div>}{error && <div className="flash error-text" role="alert">{error}</div>}
    <section className="workspace-grid">
      <div className="main-column">
        <section className="panel narrative-panel">
          <div className="section-head"><div><div className="step-label">01 / PICK A THREAD</div><h2>Your narratives</h2></div><span className="count">{narratives.length} PRIVATE</span></div>
          {narratives.length ? <label className="field"><span>Working narrative</span><select value={selectedNarrative} onChange={(e) => setSelectedNarrative(e.target.value)}>{narratives.map((n) => <option key={n.id} value={n.id}>{Number(n.is_main) === 1 ? `MAIN · ${n.title} — ${n.structural_label} by ${n.structural_deadline}` : `${n.parent_id ? '↳ ' : ''}${n.title}`}</option>)}</select></label> : <p className="empty">No narrative yet. Start a private one below, or add an existing Future Radio story when it becomes available.</p>}
          {existingMain && <div className="structural-preview"><strong>MAIN · {existingMain.title}</strong><span>{existingMain.structural_label} by {existingMain.structural_deadline} · untyped structural target</span><span>Descendant contribution subtotal: {Number(existingMain.structural_rollup_value || 0).toLocaleString()} untyped scalar</span></div>}
          {selectedNarrative && narratives.find((n) => n.id === selectedNarrative) && <div className="premise-preview">{narratives.find((n) => n.id === selectedNarrative).premise}</div>}
          <details className="create-details"><summary>Start a new narrative or substructure</summary><form onSubmit={createNarrative} className="form-stack">
            <label className="field"><span>Working title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="A name to find it by" /></label>
            <label className="field"><span>Premise</span><textarea value={premise} onChange={(e) => setPremise(e.target.value)} maxLength={3000} required placeholder="What is this story trying to hold? Keep it provisional." /></label>
            <label className="field"><span>Roll up under (optional)</span><select value={parentId} disabled={isMain} onChange={(e) => { setParentId(e.target.value); setIsMain(false); }}><option value="">Top-level narrative</option>{narratives.map((n) => <option key={n.id} value={n.id}>{Number(n.is_main) === 1 ? `MAIN · ${n.title}` : n.title}</option>)}</select></label>
            {parentId && <>
              <label className="field"><span>Structural contribution (optional, untyped scalar)</span><input type="number" min="1" step="1" value={childStructuralValue} onChange={(e) => setChildStructuralValue(e.target.value)} placeholder="Only if you want to add a scalar contribution" /></label>
              <p className="inline-note">This substructure inherits its parent’s roll-up basis. Enter additive contributions, not subtotals; the main roll-up sums descendant contributions. No revenue, valuation, or funding meaning is inferred.</p>
            </>}
            <label className="checkbox-field"><input type="checkbox" checked={isMain} disabled={!!existingMain} onChange={(e) => { const enabled = e.target.checked; setIsMain(enabled); if (enabled) { setParentId(''); setTitle((current) => current || 'Survival'); setPremise((current) => current || 'Main narrative with an intentionally untyped structural target. Substructures can share its scalar basis without implying revenue, valuation, funding, or another real-world metric.'); } }} /><span>Make this the main narrative</span></label>
            {existingMain && <p className="inline-note">This account already has one main narrative: {existingMain.title}. Only one is allowed per account.</p>}
            {isMain && <>
              <label className="field"><span>Structural target value</span><input type="number" min="1" step="1" value={structuralValue} onChange={(e) => setStructuralValue(e.target.value)} required /></label>
              <label className="field"><span>Display label</span><input value={structuralLabel} onChange={(e) => setStructuralLabel(e.target.value)} maxLength={80} required /></label>
              <label className="field"><span>Deadline</span><input type="date" value={structuralDeadline} onChange={(e) => setStructuralDeadline(e.target.value)} required /></label>
              <p className="inline-note">The target is deliberately untyped: it is not revenue, valuation, funding, or a defined currency measure. Substructures inherit one generic scalar basis so they can roll up without being mislabeled as the same real-world metric.</p>
            </>}
            <button className="button button-secondary" disabled={!!busy || (isMain && !!existingMain)}>{isMain ? 'Save main narrative' : parentId ? 'Save substructure' : 'Save private draft'}</button>
          </form></details>
        </section>

        <section className="panel generation-panel">
          <div className="section-head"><div><div className="step-label">02 / ASK FOR A DRAFT</div><h2>Make the next thing.</h2></div><span className="not-publish">NOT A PUBLISH BUTTON</span></div>
          <p className="panel-intro">The prompt is attached to the selected narrative. Every generation is a deliberate provider request on your key, capped at 2,048 output tokens; costs depend on your provider and model.</p>
          <form onSubmit={generate} className="form-stack">
            <label className="field"><span>Provider key</span><select value={selectedCredential} onChange={(e) => setSelectedCredential(e.target.value)} required><option value="" disabled>Choose a saved provider key</option>{credentials.map((credential) => <option key={credential.id} value={credential.id}>{PROVIDER_DETAILS[credential.provider]?.label || credential.provider} · {credential.label} · {credential.masked_secret}</option>)}</select></label>
            <label className="field"><span>Model ID</span><input value={model} onChange={(e) => setModel(e.target.value)} required maxLength={160} placeholder={generationProviderDetails.modelPlaceholder} /></label>
            {generationProvider === 'hashference' && <p className="small muted">Use a model that supports Chat Completions from <a href="https://hashference.com/v1/catalog" target="_blank" rel="noreferrer">Hashference’s live catalog</a>.</p>}
            <label className="field"><span>What should the room help you make?</span><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} required maxLength={12000} placeholder="Ask for one scene, a beat sheet, a question the story has not answered…" /></label>
            <button className="button button-primary" disabled={!selectedNarrative || !selectedCredential || !!busy}>{busy === 'generate' ? 'Generating…' : 'Generate a private draft'} <span>↗</span></button>
          </form>
          {!credentials.length && <p className="inline-note">Add a Hashference or OpenRouter API key in the sidebar to enable generation.</p>}
        </section>

        <section className="panel history-panel">
          <div className="section-head"><div><div className="step-label">03 / KEEP THE RECEIPT</div><h2>Recent drafts</h2></div><button className="quiet-button" onClick={() => perform('refresh', refresh)}>Refresh</button></div>
          {!generations.length ? <p className="empty">No generations yet. The record starts with the first request.</p> : <div className="generation-list">{generations.map((g) => <article className="generation-card" key={g.id}>
            <div className="generation-meta"><span className={`badge ${g.status}`}>{g.status}</span><span>{g.model}</span><time>{new Date(g.created_at).toLocaleString()}</time></div>
            <p className="generation-output">{g.status === 'succeeded' ? g.output : `Request did not complete (${g.failure_code || 'unknown'}). No automatic retry was attempted.`}</p>
            {usageText(g.usage_json) && <small className="receipt">{usageText(g.usage_json)}</small>}
            {g.provider_request_id && <small className="receipt">provider request · {g.provider_request_id}</small>}
          </article>)}</div>}
        </section>
      </div>

      <aside className="side-column">
        <XAccountLink user={user} />
        <section className="panel key-panel">
          <div className="step-label">YOUR PROVIDER KEY</div><h2>Bring your own.</h2><p className="panel-intro">Keys are encrypted before storage. Only the masked ending is shown again. The server decrypts a key only for a generation you start.</p>
          <form onSubmit={saveCredential} className="form-stack">
            <label className="field"><span>Provider</span><select value={provider} onChange={(e) => setProvider(e.target.value)}><option value="hashference">Hashference (default)</option><option value="openrouter">OpenRouter</option></select></label>
            <label className="field"><span>Label (optional)</span><input value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} maxLength={80} placeholder={`${PROVIDER_DETAILS[provider].label} key`} /></label>
            <label className="field"><span>API key</span><input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} minLength={8} maxLength={4096} required placeholder={provider === 'hashference' ? 'Paste Hashference API key (hf_...)' : 'Paste OpenRouter API key'} /></label>
            <button className="button button-secondary" disabled={!!busy || !apiKey}>Save encrypted key</button>
          </form>
          {credentials.length > 0 && <div className="key-list"><div className="key-list-title">SAVED KEYS</div>{credentials.map((c) => <div className="key-row" key={c.id}><div><strong>{c.label}</strong><small>{c.provider} · {c.masked_secret}</small></div><button className="text-button" onClick={() => revokeCredential(c.id)} disabled={!!busy}>Revoke</button></div>)}</div>}
          <div className="caution"><strong>Control stays with you.</strong><br/>The key is never sent to the browser again. Requests are not retried automatically. Deleting a key removes its encrypted value; historical generation receipts remain.</div>
        </section>
        <section className="panel boundary-panel"><div className="step-label">THE BOUNDARY</div><p>Private drafts are not published, canonized, or attributed to Future Radio. This first workspace has no payment, staking, wallet transaction, or public-posting flow.</p><p className="small muted">Hashference and OpenRouter use their OpenAI-compatible Chat Completions endpoints. Model IDs are provider-specific; no model is silently substituted.</p></section>
      </aside>
    </section>
    <footer className="footer"><span>FUTURE RADIO × STORY.MARKETS</span><span>Private by default. Nothing publishes from this room.</span></footer>
  </main>;
}
