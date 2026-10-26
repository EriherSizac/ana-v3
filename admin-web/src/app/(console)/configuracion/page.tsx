'use client';

import { CliSettingsView } from '@/components/settings/CliSettingsView';
import { DesktopSettingsSection } from '@/components/settings/DesktopSettingsSection';

export default function ConfiguracionPage() {
  return (
    <CliSettingsView>
      <DesktopSettingsSection />
    </CliSettingsView>
  );
}
