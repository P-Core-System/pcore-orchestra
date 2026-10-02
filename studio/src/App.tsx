import { Routes, Route, Link, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', label: 'WorkItems', icon: '📋' },
  { path: '/runs', label: 'Runs', icon: '▶️' },
  { path: '/evidence', label: 'Evidence', icon: '🔍' },
  { path: '/reviews', label: 'Reviews', icon: '✅' },
  { path: '/tokens', label: 'Tokens', icon: '💰' },
];

function Sidebar() {
  const location = useLocation();
  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">P-Core Orchestra Studio</h1>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              location.pathname === item.path
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function Header() {
  return (
    <header className="bg-gray-800 text-white px-6 py-4 border-b border-gray-700">
      <h2 className="text-2xl font-semibold">P-Core Orchestra Studio</h2>
    </header>
  );
}

function WorkItemsPage() {
  return (
    <div className="p-6">
      <h3 className="text-xl font-semibold mb-4">WorkItems Board</h3>
      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-gray-500">WorkItem board (Triage → Done) - coming soon</p>
      </div>
    </div>
  );
}

function RunsPage() {
  return (
    <div className="p-6">
      <h3 className="text-xl font-semibold mb-4">Conductor Runs</h3>
      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-gray-500">Run list and detail view - coming soon</p>
      </div>
    </div>
  );
}

function EvidencePage() {
  return (
    <div className="p-6">
      <h3 className="text-xl font-semibold mb-4">Gate Evidence</h3>
      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-gray-500">Evidence visualizer with excerpts and handoff digest - coming soon</p>
      </div>
    </div>
  );
}

function ReviewsPage() {
  return (
    <div className="p-6">
      <h3 className="text-xl font-semibold mb-4">Human Review Inbox</h3>
      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-gray-500">Review queue from phase outcomes - coming soon</p>
      </div>
    </div>
  );
}

function TokensPage() {
  return (
    <div className="p-6">
      <h3 className="text-xl font-semibold mb-4">Token & Cost Charts</h3>
      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-gray-500">Token aggregates and trend charts - coming soon</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<WorkItemsPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/evidence" element={<EvidencePage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/tokens" element={<TokensPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;