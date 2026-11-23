import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
      <div>
        <p className="font-semibold text-sky-700">HealthWallet</p>
        <h1 className="mt-4 text-4xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-3 text-slate-600">The page you are looking for is not available.</p>
        <Link
          className="mt-6 inline-block rounded-full bg-sky-700 px-5 py-3 font-semibold text-white"
          href="/"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
