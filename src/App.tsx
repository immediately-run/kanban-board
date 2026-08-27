// Root component — immediately.run renders the default export of THIS file.
// Global CSS is imported here (not in main.tsx) because immediately.run's
// runtime never loads main.tsx; anything the rendered tree needs must be
// reachable from App.tsx.
import './index.css';
import './App.css';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Features from './components/Features';
import Counter from './components/Counter';
import Footer from './components/Footer';

function App() {
  return (
    <>
      <Nav />
      <main className="wrap">
        <Hero />
        <Features />
        <Counter />
        <Footer />
      </main>
    </>
  );
}

export default App;
