import { VerifyForm } from '../../auth/verify-form';

export default function VerifyOtpPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top_right,_#dff3fc,_transparent_50%),linear-gradient(135deg,#f5fbfe,#fff_65%)] px-5 py-12">
      <VerifyForm />
    </main>
  );
}
