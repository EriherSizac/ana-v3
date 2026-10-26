'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { UploadDetailView } from '@/components/contacts/UploadDetailView';
import { V4ReviewView } from '@/components/contacts/V4ReviewView';
import { InlineMessage, PageContainer } from '@/components/ui';

function Detail() {
  const params = useParams<{ uploadId: string }>();
  const search = useSearchParams();
  const campaign = search?.get('campaign');
  const uploadId = decodeURIComponent(String(params?.uploadId ?? ''));
  if (!campaign) {
    return (
      <PageContainer narrow>
        <InlineMessage>Falta la campaña. Abre el detalle desde el historial.</InlineMessage>
      </PageContainer>
    );
  }
  // v4: el id es el srcKey de la carga; `all` = toda la campaña (incluye envíos directos).
  if (search?.get('fleet') === 'v4') return <V4ReviewView campaign={campaign} srcKey={uploadId === 'all' ? null : uploadId} />;
  return <UploadDetailView uploadId={uploadId} campaign={campaign} />;
}

export default function UploadDetailPage() {
  return (
    <Suspense>
      <Detail />
    </Suspense>
  );
}
