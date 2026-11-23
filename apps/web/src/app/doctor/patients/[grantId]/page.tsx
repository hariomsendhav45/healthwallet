'use client';
import { useParams } from 'next/navigation';
import { DoctorPatientAccessPage } from '../../../../components/medical-sharing-pages';
export default function Page() {
  const params = useParams<{ grantId: string }>();
  return <DoctorPatientAccessPage grantId={params.grantId} />;
}
