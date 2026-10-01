import { Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireManagerRole, RequireSettingsRole } from './guards';
import { AppShell } from './shell/AppShell';
import { LoginPage } from '../pages/LoginPage';
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/auth/ResetPasswordPage';
import { LandingPage } from '../pages/LandingPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { UnauthorizedPage } from '../pages/UnauthorizedPage';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { WorkspacePage } from '../pages/workspace/WorkspacePage';
import { LeadsPage } from '../pages/leads/LeadsPage';
import { LeadDetailPage } from '../pages/leads/LeadDetailPage';
import { PatientsPage } from '../pages/patients/PatientsPage';
import { PatientProfilePage } from '../pages/patients/PatientProfilePage';
import { AppointmentsPage } from '../pages/appointments/AppointmentsPage';
import { AppointmentDetailPage } from '../pages/appointments/AppointmentDetailPage';
import { CommunicationsPage } from '../pages/communications/CommunicationsPage';
import { RecallPage } from '../pages/recall/RecallPage';
import { AutomationsPage } from '../pages/automations/AutomationsPage';
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
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/" element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<LandingPage />} />
          <Route path="unauthorized" element={<UnauthorizedPage />} />
          <Route path="dashboard" element={<RequireManagerRole />}>
            <Route index element={<DashboardPage />} />
          </Route>
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="leads/:leadId" element={<LeadDetailPage />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="patients/:patientId" element={<PatientProfilePage />} />
          <Route path="appointments" element={<AppointmentsPage />} />
          <Route path="appointments/:appointmentId" element={<AppointmentDetailPage />} />
          <Route path="communications" element={<CommunicationsPage />} />
          <Route path="recall" element={<RecallPage />} />
          <Route path="automations" element={<RequireManagerRole />}>
            <Route index element={<AutomationsPage />} />
          </Route>
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
    </Routes>
  );
}
