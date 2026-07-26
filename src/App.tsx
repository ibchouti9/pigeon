import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { useTheme } from './hooks/useTheme';
import { useScenario } from './hooks/useScenario';
import { useSettings } from './store/settings';

import { WelcomeRoute } from './routes/onboarding/WelcomeRoute';
import { ProviderSetupRoute } from './routes/onboarding/ProviderSetupRoute';
import { SyncRoute } from './routes/onboarding/SyncRoute';
import { KnownSendersRoute } from './routes/onboarding/KnownSendersRoute';
import { ScreenerIntroRoute } from './routes/onboarding/ScreenerIntroRoute';

import { InboxRoute } from './routes/InboxRoute';
import { ArchiveRoute } from './routes/ArchiveRoute';
import { ScreenerRoute } from './routes/ScreenerRoute';
import { SearchRoute } from './routes/SearchRoute';
import { SettingsRoute } from './routes/settings/SettingsRoute';
import { AccountSettings } from './routes/settings/AccountSettings';
import { SendersSettings } from './routes/settings/SendersSettings';
import { AssistantSettings } from './routes/settings/AssistantSettings';
import { AboutSettings } from './routes/settings/AboutSettings';
import { StatesRoute } from './routes/dev/StatesRoute';

/** Onboarding runs once per account; after that /welcome redirects to /inbox. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const onboarded = useSettings((s) => s.onboarded);
  if (onboarded) return <Navigate to="/inbox" replace />;
  return <>{children}</>;
}

function ShellGate() {
  const onboarded = useSettings((s) => s.onboarded);
  if (!onboarded) return <Navigate to="/welcome" replace />;
  return <AppShell />;
}

export default function App() {
  useTheme();
  useScenario();

  return (
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
      <Route path="/setup/provider" element={<ProviderSetupRoute />} />
      <Route path="/setup/sync" element={<SyncRoute />} />
      <Route path="/setup/senders" element={<KnownSendersRoute />} />
      <Route path="/setup/screener" element={<ScreenerIntroRoute />} />

      <Route element={<ShellGate />}>
        <Route path="/inbox" element={<InboxRoute />} />
        <Route path="/inbox/t/:threadId" element={<InboxRoute />} />
        <Route path="/archive" element={<ArchiveRoute />} />
        <Route path="/archive/t/:threadId" element={<ArchiveRoute />} />
        <Route path="/screener" element={<ScreenerRoute />} />
        <Route path="/screener/s/:senderId" element={<ScreenerRoute />} />
        <Route path="/search" element={<SearchRoute />} />
        <Route path="/search/t/:threadId" element={<SearchRoute />} />
        <Route path="/settings" element={<SettingsRoute />}>
          <Route index element={<Navigate to="/settings/account" replace />} />
          <Route path="account" element={<AccountSettings />} />
          <Route path="senders" element={<SendersSettings />} />
          <Route path="assistant" element={<AssistantSettings />} />
          <Route path="about" element={<AboutSettings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}
