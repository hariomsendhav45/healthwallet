const features = [
  { icon: '▤', title: 'Your records, together', text: 'Keep reports and important health documents organized in one private place.' },
  { icon: '⌁', title: 'Share with care', text: 'Choose what to share and who can see it, with access that can expire.' },
  { icon: '♡', title: 'Health, over time', text: 'Build a clearer picture of your health as your records grow.' },
];

function AccessPassIllustration() {
  return <figure className="mx-auto w-full max-w-md text-center">
    <div className="relative rounded-[28px] bg-[#f2f6f4] p-8 text-left text-[#152722] shadow-2xl shadow-black/20 sm:p-10">
      <p className="font-semibold text-[#155c50]">Access pass</p>
      <h2 className="mt-2 text-2xl font-semibold leading-tight">Your health records,<br />shared on your terms</h2>
      <p className="mt-2 text-[#586a65]">Only with the people you choose</p>
      <div className="mt-6 flex justify-between text-sm"><span className="text-[#586a65]">Access control</span><span className="font-semibold">Revoke any time</span></div>
      <div className="mt-2 h-3 rounded-full bg-[#d4ded9]"><div className="h-full w-2/3 rounded-full bg-[#efa916]" /></div>
      <div className="my-5 border-t-2 border-dashed border-[#b9c8c2]" />
      <div className="flex items-center justify-between gap-5">
        <div aria-label="Decorative QR code illustration" className="grid h-28 w-28 shrink-0 grid-cols-7 gap-1" role="img">{Array.from({length:49},(_,i)=><span key={i} className={(i*17+i%3*7)%5<2?'bg-[#082b25]':'bg-transparent'} />)}</div>
        <p className="text-right text-sm leading-6 text-[#586a65]">Only what you chose.<br/><strong className="text-[#155c50]">Access stays in your control</strong></p>
      </div>
    </div>
    <figcaption className="mt-4 text-sm text-[#b9d2ca]">Illustration · no patient data shown</figcaption>
  </figure>;
}

export default function Home() {
  return <main className="min-h-screen bg-[#171918] px-3 py-3 sm:px-6 sm:py-6">
    <div className="mx-auto max-w-[1500px] overflow-hidden rounded-[26px] border border-white/80 bg-white shadow-2xl">
      <section id="home" className="bg-[#062b25] text-white">
        <header className="mx-auto flex max-w-[1380px] items-center justify-between px-6 py-5 sm:px-10 sm:py-8">
          <a href="#home" className="flex items-center gap-3 text-xl font-bold sm:text-2xl"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f3b536] text-2xl text-[#092c26]">✚</span>HealthWallet</a>
          <nav aria-label="Main navigation" className="flex items-center gap-3 text-sm text-[#cee0da] sm:gap-8 sm:text-base"><a className="hidden sm:inline" href="#home">Home</a><a className="hidden sm:inline" href="#about">About</a><a className="hidden sm:inline" href="#features">Features</a><a className="rounded-xl border border-[#7fb5a9] px-5 py-2.5 font-semibold text-white hover:bg-white/10" href="/login">Login</a></nav>
        </header>
        <div className="mx-auto grid max-w-[1380px] items-center gap-12 px-6 pb-14 pt-8 sm:px-10 sm:pb-16 md:grid-cols-[1.1fr_.9fr] md:gap-16 md:py-12 lg:py-16">
          <div>
            <h1 className="max-w-2xl text-4xl leading-[1.12] font-semibold tracking-tight sm:text-5xl lg:text-6xl">Your health records,<br/>within reach.</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#cee0da] sm:text-xl">Keep your medical history organized and ready when you need it. HealthWallet gives you a private place for the information that matters.</p>
            <div className="mt-8 flex flex-wrap gap-4"><a href="/register" className="rounded-2xl bg-[#f3b536] px-7 py-3.5 text-lg font-semibold text-[#082b25] hover:bg-[#ffc84e]">Get started</a><a href="#about" className="rounded-2xl border border-[#7fb5a9] px-7 py-3.5 text-lg font-semibold hover:bg-white/10">Learn about HealthWallet</a></div>
          </div>
          <AccessPassIllustration />
        </div>
      </section>
      <section id="about" className="mx-auto grid max-w-[1380px] divide-y divide-[#d5dfda] px-6 sm:px-10 md:grid-cols-3 md:divide-x md:divide-y-0">
        {features.map((f)=><article id={f.title==='Share with care'?'features':undefined} key={f.title} className="px-2 py-8 sm:px-6 sm:py-10 md:px-8 md:py-12"><span className="grid h-8 w-8 place-items-center border border-[#155c50] text-lg text-[#155c50]" aria-hidden="true">{f.icon}</span><h2 className="mt-5 text-xl font-semibold text-[#182b25] sm:text-2xl">{f.title}</h2><p className="mt-2 max-w-sm text-base leading-7 text-[#586a65] sm:text-lg">{f.text}</p></article>)}
      </section>
      <footer className="flex flex-col gap-2 border-t border-[#d5dfda] px-8 py-5 text-sm text-[#586a65] sm:flex-row sm:justify-between"><span className="font-semibold text-[#155c50]">HealthWallet</span><span>Private tools for your health information · © {new Date().getFullYear()}</span></footer>
    </div>
  </main>;
}
