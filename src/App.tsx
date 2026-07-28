import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { MobileShell } from './components/shell/MobileShell';
import { useBreakpoint } from './hooks/useBreakpoint';
import { useTheme } from './hooks/useTheme';
import { useScenario } from './hooks/useScenario';
import { useRestoreProvider } from './hooks/useRestoreProvider';
import { useSettings } from './store/settings';

const WelcomeRoute = lazy(() => import('./routes/onboarding/WelcomeRoute').then((m) => ({ default: m.WelcomeRoute })));
const ProviderSetupRoute = lazy(() => import('./routes/onboarding/ProviderSetupRoute').then((m) => ({ default: m.ProviderSetupRoute })));
const SyncRoute = lazy(() => import('./routes/onboarding/SyncRoute').then((m) => ({ default: m.SyncRoute })));
const KnownSendersRoute = lazy(() => import('./routes/onboarding/KnownSendersRoute').then((m) => ({ default: m.KnownSendersRoute })));
const ScreenerIntroRoute = lazy(() => import('./routes/onboarding/ScreenerIntroRoute').then((m) => ({ default: m.ScreenerIntroRoute })));

import { InboxRoute } from './routes/InboxRoute';
import { ArchiveRoute } from './routes/ArchiveRoute';
import { SentRoute } from './routes/SentRoute';
const LedgerRoute = lazy(() => import('./routes/LedgerRoute').then((m) => ({ default: m.LedgerRoute })));
const BriefRoute = lazy(() => import('./routes/BriefRoute').then((m) => ({ default: m.BriefRoute })));
import { DraftsRoute } from './routes/DraftsRoute';
const ScreenerRoute = lazy(() => import('./routes/ScreenerRoute').then((m) => ({ default: m.ScreenerRoute })));
// Reachable only from the phone's tab bar, so it has no business in the chunk
// a desktop build downloads before its first paint.
const MoreRoute = lazy(() => import('./routes/MoreRoute').then((m) => ({ default: m.MoreRoute })));
const SearchRoute = lazy(() => import('./routes/SearchRoute').then((m) => ({ default: m.SearchRoute })));
const SettingsRoute = lazy(() => import('./routes/settings/SettingsRoute').then((m) => ({ default: m.SettingsRoute })));
const SettingsIndex = lazy(() => import('./routes/settings/SettingsRoute').then((m) => ({ default: m.SettingsIndex })));
const AccountSettings = lazy(() => import('./routes/settings/AccountSettings').then((m) => ({ default: m.AccountSettings })));
const SendersSettings = lazy(() => import('./routes/settings/SendersSettings').then((m) => ({ default: m.SendersSettings })));
const AssistantSettings = lazy(() => import('./routes/settings/AssistantSettings').then((m) => ({ default: m.AssistantSettings })));
const AboutSettings = lazy(() => import('./routes/settings/AboutSettings').then((m) => ({ default: m.AboutSettings })));
import { StatesRoute } from './routes/dev/StatesRoute';

/**
 * §3.1 step 6 — "O1–O5 are never shown again for this account". Only /welcome
 * was gated, so the four /setup routes stayed reachable by URL and, more
 * realistically, by pressing Back from the inbox at the end of onboarding —
 * which walked a finished user straight into O5 again.
 *
 * `onboarded` is set once, at the end of O5, so gating these does not fence
 * anyone out of the flow they are still walking. The dev harness clears the
 * flag first (`/welcome?reset=1`), which is how it reaches them.
 */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const onboarded = useSettings((s) => s.onboarded);
  const [params] = useSearchParams();

  /*
   * §8.5 item 1's harness links straight at O2–O5, and gating them sent every
   * one to /inbox: the only way back in was to clear the flag from /welcome,
   * which navigates away from the harness. `reset=1` is the same marker that
   * page already uses, and `useScenario` clears the flag when it sees it.
   */
  if (import.meta.env.DEV && params.get('reset') === '1') return <>{children}</>;

  if (onboarded) return <Navigate to="/inbox" replace />;
  return <>{children}</>;
}

/**
 * Which shell, and whether the account has earned one yet.
 *
 * The two shells are chosen at the top rather than swapped inside one, so a
 * rotation from portrait to landscape on a small phone unmounts one and mounts
 * the other. That costs the screen's scroll position and is the right trade:
 * a half-applied shell — a tab bar under a rail, or a reader beside nothing —
 * is the failure mode a shared component tree would produce instead.
 */
function ShellGate() {
  const onboarded = useSettings((s) => s.onboarded);
  const phone = useBreakpoint() === 'phone';
  if (!onboarded) return <Navigate to="/welcome" replace />;
  return phone ? <MobileShell /> : <AppShell />;
}

export default function App() {
  // Before anything mounts a route: the shell loads the inbox on mount, and it
  // has to ask the right account for it.
  useRestoreProvider();
  useTheme();
  useScenario();

  return (
    /*
     * Onboarding runs once per account and Settings is opened rarely, so
     * neither belongs in the chunk that has to arrive before the first screen
     * paints. `null` rather than a spinner: these resolve from cache in a
     * frame or two, and a flash of a loading state is worse than a frame of
     * the screen the user was already on.
     */
    <Suspense fallback={null}>
    <Routes>
      {/* §8.5 item 1's dev harness. Dev builds only. */}
      {import.meta.env.DEV && <Route path="/dev/states" element={<StatesRoute />} />}
      <Route
        path="/welcome"
        element={
          <OnboardingGate>
            <WelcomeRoute />
          </OnboardingGate>
        }
      />
      <Route
        path="/setup/provider"
        element={
          <OnboardingGate>
            <ProviderSetupRoute />
          </OnboardingGate>
        }
      />
      <Route
        path="/setup/sync"
        element={
          <OnboardingGate>
            <SyncRoute />
          </OnboardingGate>
        }
      />
      <Route
        path="/setup/senders"
        element={
          <OnboardingGate>
            <KnownSendersRoute />
          </OnboardingGate>
        }
      />
      <Route
        path="/setup/screener"
        element={
          <OnboardingGate>
            <ScreenerIntroRoute />
          </OnboardingGate>
        }
      />

      <Route element={<ShellGate />}>
        <Route path="/inbox" element={<InboxRoute />} />
        <Route path="/inbox/t/:threadId" element={<InboxRoute />} />
        <Route path="/archive" element={<ArchiveRoute />} />
        <Route path="/archive/t/:threadId" element={<ArchiveRoute />} />
        <Route path="/brief" element={<BriefRoute />} />
        <Route path="/ledger" element={<LedgerRoute />} />
        <Route path="/sent" element={<SentRoute />} />
        <Route path="/sent/t/:threadId" element={<SentRoute />} />
        <Route path="/drafts" element={<DraftsRoute />} />
        <Route path="/drafts/t/:threadId" element={<DraftsRoute />} />
        <Route path="/screener" element={<ScreenerRoute />} />
        <Route path="/screener/s/:senderId" element={<ScreenerRoute />} />
        <Route path="/search" element={<SearchRoute />} />
        {/*
          Routed on every build, not only the phone: a desktop window dragged
          below 720px becomes the phone shell mid-session, and a tab bar whose
          fifth destination 404s is worse than one extra route definition.
        */}
        <Route path="/more" element={<MoreRoute />} />
        <Route path="/search/t/:threadId" element={<SearchRoute />} />
        <Route path="/settings" element={<SettingsRoute />}>
          {/*
            Not a bare `<Navigate>`: on a phone the sub-nav is the screen, so
            `/settings` has somewhere to be rather than somewhere to leave.
          */}
          <Route index element={<SettingsIndex />} />
          <Route path="account" element={<AccountSettings />} />
          <Route path="senders" element={<SendersSettings />} />
          <Route path="assistant" element={<AssistantSettings />} />
          <Route path="about" element={<AboutSettings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
    </Suspense>
  );
}
