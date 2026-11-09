import './App.css'
import Experience from './components/Experience'
import SpinningLogo3D from './components/SpinningLogo3D'

function App() {
  return (
    <div className="bg-butterfly-100 min-h-screen ">
      <div className="w-full border-b pb-4 sticky top-0 z-50 ">
        <header className="max-w-6xl mx-auto pt-4 px-4 flex justify-between items-center text-premium-black font-syne">
          <a href="#" className="text-xl md:text-2xl font-bold flex flex-row items-center">
            <SpinningLogo3D/>Keiixx22
          </a>
          <nav className="flex gap-4 md:gap-10 text-sm md:text-base font-medium">
            <a href="#work" className="hover:opacity-70 transition-opacity">Work</a>
            <a href="#contact" className="hover:opacity-70 transition-opacity">Contact</a>
          </nav>
        </header>
      </div>

      <main className="px-4">
        <section className="flex flex-col gap-6 md:gap-10 mt-24 md:mt-40 mx-auto max-w-4xl">
          <h1 className="font-syne font-bold text-butterfly-950 text-shadow-md text-4xl md:text-6xl hover:text-butterfly-600 transition-colors">
            Hi There
          </h1>
          <p className="font-tally text-butterfly-950 text-base leading-relaxed max-w-2xl">
            I'm Pandu, a college student at Universitas Muhammadiyah Surakarta and a junior web developer. I build clean, responsive, and user-friendly websites, and I'm always learning to keep up with modern web technologies.
          </p>
        </section>
        <section>
          <div className='max-w-4xl min-h-screen mx-auto mt-25 font-tally text-butterfly-950'>
            <h1>Here is some my project</h1>
            <Experience/>

          </div>
        </section>
      </main>
    </div>
  )
}

export default App