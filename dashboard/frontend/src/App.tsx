import { NavLink, useLocation } from 'react-router-dom';
import TranslationsPage from './pages/TranslationsPage';
import LanguagesPage from './pages/LanguagesPage';
import ImportExportPage from './pages/ImportExportPage';
import ActiveRunsBar from './components/ActiveRunsBar';

function App() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">i18n Translation Dashboard</h1>
        <nav className="app-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Translations
          </NavLink>
          <NavLink
            to="/languages"
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Languages
          </NavLink>
          <NavLink
            to="/import-export"
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Import / Export
          </NavLink>
        </nav>
      </header>
      <main className="app-main">
        {/*
          All three pages stay mounted at all times (visibility toggled via
          `hidden`, not swapped in/out via <Routes>) so switching tabs never
          unmounts a page -- an in-progress file upload, the translations
          filters/search/page, etc. all survive navigating away and back.
        */}
        <div hidden={location.pathname !== '/'}>
          <TranslationsPage />
        </div>
        <div hidden={location.pathname !== '/languages'}>
          <LanguagesPage />
        </div>
        <div hidden={location.pathname !== '/import-export'}>
          <ImportExportPage />
        </div>
      </main>
      <ActiveRunsBar />
    </div>
  );
}

export default App;
