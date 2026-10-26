import Link from 'next/link';
import { PageContainer } from '@/components/ui/Page';

export default function NotFound() {
  return (
    <PageContainer narrow>
      <div className="pernexium-card p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">No encontrado</h1>
        <p className="mt-2 text-sm text-text-light">La página que buscas no existe o fue movida.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        >
          Volver al inicio
        </Link>
      </div>
    </PageContainer>
  );
}
