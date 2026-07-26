import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAiFailingForDev, setAiFailureForDev } from '../../ai/client';
import { SCENARIOS, type ScenarioName } from '../../data/mock/scenarios';
import { useCompose } from '../../store/compose';
import { useSettings } from '../../store/settings';
import type { Draft } from '../../types';
import { cn } from '../../lib/cn';
import styles from './StatesRoute.module.css';

/**
 * §8.5 item 1 — every screen renders its empty, loading and error states,
 * reachable in a dev harness.
 *
 * Each link applies a scenario to the mail provider and opens a real route, so
 * the states are reached through the screens' own code rather than by mounting
 * components with fixture props. Dev builds only.
 */

const ROUTES: { path: string; label: string; note: string }[] = [
  { path: '/inbox', label: '/inbox', note: '§5.5 list column' },
  { path: '/inbox/t/t1', label: '/inbox/t/:id', note: '§5.6 reader' },
  { path: '/archive', label: '/archive', note: '§5.10' },
  { path: '/screener', label: '/screener', note: '§5.7 stack' },
  { path: '/screener?view=list', label: '/screener (bulk)', note: '§5.8' },
  { path: '/search?q=atlas', label: '/search', note: '§5.11' },
  { path: '/settings/senders', label: '/settings/senders', note: '§5.13b' },
  { path: '/settings/assistant', label: '/settings/assistant', note: '§5.13c' },
  { path: '/screener/s/s-held-0', label: '/screener/s/:id', note: '§5.9 held sheet' },
];

/*
 * Each carries `reset=1`: §3.1 step 6 gates these behind the onboarded flag,
 * and without it every link here lands on /inbox. The gate honours the marker
 * in dev builds, and `useScenario` clears the flag when it sees it.
 */
const ONBOARDING: { path: string; label: string; note: string }[] = [
  { path: '/welcome?reset=1', label: 'O1 Welcome', note: '§5.1' },
  { path: '/setup/provider?reset=1', label: 'O2 Provider', note: '§5.2' },
  { path: '/setup/sync?reset=1', label: 'O3 Sync', note: '§5.2b' },
  { path: '/setup/senders?reset=1', label: 'O4 Known senders', note: '§5.3' },
  { path: '/setup/screener?reset=1', label: 'O5 Screener intro', note: '§5.4' },
];

/** §5.12's states come from the draft, not from the provider. */
const COMPOSER_STATES: { label: string; note: string; draft: Partial<Draft> }[] = [
  { label: 'Empty', note: 'send disabled, no recipient', draft: {} },
  {
    label: 'Send-blocked',
    note: 'D26 unresolved [confirm:]',
    draft: {
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
      subject: 'Redlines',
      body: 'Does [confirm: a time on Thursday] work?',
      aiState: 'drafted',
    },
  },
  {
    label: 'AI-drafted',
    note: 'AI ink on the AI tint',
    draft: {
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
      subject: 'Redlines',
      body: 'Happy with 750 as a middle. I will send the redline back tonight.',
      aiState: 'drafted',
    },
  },
  {
    label: 'AI-drafted, edited',
    note: 'tint cleared, provenance keeps saying so',
    draft: {
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
      subject: 'Redlines',
      body: 'Happy with 750 as a middle.',
      aiState: 'edited',
    },
  },
  {
    label: 'Invalid recipient',
    note: "§7.6 isn't a complete address",
    draft: { to: [{ name: '', email: 'dana@lumen' }], subject: 'Redlines' },
  },
];

function withScenario(path: string, scenario: ScenarioName): string {
  const [pathname, search] = path.split('?');
  const params = new URLSearchParams(search);
  params.set('scenario', scenario);
  return `${pathname}?${params.toString()}`;
}

export function StatesRoute() {
  const navigate = useNavigate();
  const [aiFailing, setAiFailing] = useState(isAiFailingForDev());
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className="t-display-md">States</h1>
        <p className={cn('t-md', styles.lede)}>
          Each link applies a scenario to the mail provider, then opens a real route. The
          scenario sticks until you pick another one or reload without the parameter. This
          page is not part of the product and is not built in production.
        </p>

        {SCENARIOS.map((scenario) => (
          <section key={scenario.name} className={styles.section}>
            <h2 className={cn('t-mono-sm', styles.sectionTitle)}>{scenario.label}</h2>
            <p className={cn('t-sm', styles.sectionNote)}>{scenario.description}</p>
            <div className={styles.grid}>
              {ROUTES.map((route) => (
                <Link
                  key={route.path}
                  to={withScenario(route.path, scenario.name)}
                  className={styles.link}
                >
                  <span className={cn('t-sm', styles.linkRoute)}>{route.label}</span>
                  <span className={cn('t-xs', styles.linkNote)}>{route.note}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section className={styles.section}>
          <h2 className={cn('t-mono-sm', styles.sectionTitle)}>Onboarding</h2>
          <p className={cn('t-sm', styles.sectionNote)}>
            O1–O5 run outside the shell and are gated once onboarding is done, so each
            link below clears the onboarded flag on its way in.
          </p>
          <div className={styles.grid}>
            {ONBOARDING.map((route) => (
              <Link key={route.path} to={route.path} className={styles.link}>
                <span className={cn('t-sm', styles.linkRoute)}>{route.label}</span>
                <span className={cn('t-xs', styles.linkNote)}>{route.note}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={cn('t-mono-sm', styles.sectionTitle)}>Composer</h2>
          <p className={cn('t-sm', styles.sectionNote)}>
            §5.12's states are driven by the draft rather than the provider, so they open
            a composer already in each one.
          </p>
          <div className={styles.grid}>
            {COMPOSER_STATES.map((state) => (
              <button
                key={state.label}
                type="button"
                className={styles.link}
                onClick={() => {
                  useCompose.getState().close();
                  useCompose.getState().open(state.draft);
                  // This page lives outside the shell, and the dock is mounted
                  // by the shell — so opening a draft here has to land
                  // somewhere the dock exists.
                  navigate('/inbox');
                }}
              >
                <span className={cn('t-sm', styles.linkRoute)}>{state.label}</span>
                <span className={cn('t-xs', styles.linkNote)}>{state.note}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={cn('t-mono-sm', styles.sectionTitle)}>Assistant failure</h2>
          <p className={cn('t-sm', styles.sectionNote)}>
            The scenarios above swap the mail provider; the assistant is separate, and no
            provider that runs without a key ever fails. This makes every AI call reject,
            so §3.4 2b&apos;s &quot;Summary unavailable.&quot;, the omitted card read and
            the digest fallback are all reachable. Stays on until you turn it off.
          </p>
          <div className={styles.grid}>
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                setAiFailureForDev(!isAiFailingForDev());
                setAiFailing(isAiFailingForDev());
              }}
            >
              <span className={cn('t-sm', styles.linkRoute)}>
                {aiFailing ? 'Assistant is failing — turn off' : 'Make every AI call fail'}
              </span>
              <span className={cn('t-xs', styles.linkNote)}>§3.4 2b · §5.7</span>
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={cn('t-mono-sm', styles.sectionTitle)}>Provider connection (C-27)</h2>
          <p className={cn('t-sm', styles.sectionNote)}>
            The status pill in §5.13c has three states and the panel's own status line has
            eight. These set the stored connection result; open Settings → Assistant to see
            the pill, or press Test connection there to drive the panel's own line.
          </p>
          <div className={styles.grid}>
            {(['connected', 'rejected', 'unknown'] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={styles.link}
                onClick={() => useSettings.getState().setConnection(status)}
              >
                <span className={cn('t-sm', styles.linkRoute)}>{status}</span>
                <span className={cn('t-xs', styles.linkNote)}>§5.13c pill</span>
              </button>
            ))}
          </div>
        </section>

        <p className={cn('t-xs', styles.footer)}>
          Missing here: the offline banner, which follows the browser rather than the
          provider — use your browser&apos;s offline toggle.
        </p>
      </div>
    </div>
  );
}
