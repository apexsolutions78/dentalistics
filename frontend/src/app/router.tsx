import { Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireSettingsRole } from './guards';
import { AppShell } from './shell/AppShell';
import { LoginPage } from '../pages/LoginPage';
import { LandingPage } from '../pages/LandingPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { UnauthorizedPage } from '../pages/UnauthorizedPage';
import { SettingsOverviewPage } from '../pages/settings/SettingsOverviewPage';
import { ClinicSettingsPage } from '../pages/settings/ClinicSettingsPage';
import { UsersRolesPage } from '../pages/settings/UsersRolesPage';
import { CommunicationSettingsPage } from '../pages/settings/CommunicationSettingsPage';
import { TemplatesPage } from '../pages/settings/TemplatesPage';
import { TemplateEditorPage } from '../pages/settings/TemplateEditorPage';
import { AppointmentSettingsPage } from '../pages/settings/AppointmentSettingsPage';
import { RecallSettingsPage } from '../pages/settings/RecallSettingsPage';
import { ReviewSettingsPage } from '../pages/settings/ReviewSettingsPage';
import { AutomationSettingsPage } from '../pages/settings/AutomationSettingsPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<LandingPage />} />
          <Route path="unauthorized" element={<UnauthorizedPage />} />
          <Route path="settings" element={<RequireSettingsRole />}>
            <Route index element={<SettingsOverviewPage />} />
            <Route path="clinic" element={<ClinicSettingsPage />} />
            <Route path="users" element={<UsersRolesPage />} />
            <Route path="communication" element={<CommunicationSettingsPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="templates/:templateName" element={<TemplateEditorPage />} />
            <Route path="appointments" element={<AppointmentSettingsPage />} />
            <Route path="recall" element={<RecallSettingsPage />} />
            <Route path="reviews" element={<ReviewSettingsPage />} />
            <Route path="automation" element={<AutomationSettingsPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
