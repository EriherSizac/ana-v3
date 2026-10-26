import { Suspense } from 'react';
import { LoginView, LoginShell } from '@/components/system/LoginView';
import { Skeleton } from '@/components/ui/Skeleton';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <LoginShell>
          <Skeleton className="h-10 w-full bg-white/20" />
        </LoginShell>
      }
    >
      <LoginView />
    </Suspense>
  );
}
