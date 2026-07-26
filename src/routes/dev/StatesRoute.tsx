import { Link } from 'react-router-dom';
import { SCENARIOS, type ScenarioName } from '../../data/mock/scenarios';
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
];

const ONBOARDING: { path: string; label: string; note: string }[] = [
  { path: '/welcome', label: 'O1 Welcome', note: '§5.1' },
  { path: '/setup/provider', label: 'O2 Provider', note: '§5.2' },
  { path: '/setup/sync', label: 'O3 Sync', note: '§5.2b' },
  { path: '/setup/senders', label: 'O4 Known senders', note: '§5.3' },
  { path: '/setup/screener', label: 'O5 Screener intro', note: '§5.4' },
];

function withScenario(path: string, scenario: ScenarioName): string {
  const [pathname, search] = path.split('?');
  const params = new URLSearchParams(search);
  params.set('scenario', scenario);
  return `${pathname}?${params.toString()}`;
}

export function StatesRoute() {
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
            O1–O5 run outside the shell. Reaching them needs the onboarded flag cleared,
            which the first link does.
          </p>
          <div className={styles.grid}>
            <Link to="/welcome?reset=1" className={styles.link}>
              <span className={cn('t-sm', styles.linkRoute)}>Restart onboarding</span>
              <span className={cn('t-xs', styles.linkNote)}>clears the onboarded flag</span>
            </Link>
            {ONBOARDING.map((route) => (
              <Link key={route.path} to={route.path} className={styles.link}>
                <span className={cn('t-sm', styles.linkRoute)}>{route.label}</span>
                <span className={cn('t-xs', styles.linkNote)}>{route.note}</span>
              </Link>
            ))}
          </div>
        </section>

        <p className={cn('t-xs', styles.footer)}>
          Missing here: the offline banner, which follows the browser rather than the
          provider — use your browser's offline toggle.
        </p>
      </div>
    </div>
  );
}
