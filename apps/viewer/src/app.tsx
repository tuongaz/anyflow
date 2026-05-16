import { Outlet, Route, Routes } from 'react-router-dom';

import { ViewerHeader } from './components/viewer-header';
import { FlowView } from './pages/flow-view.tsx';
import { Home } from './pages/home.tsx';

function ViewerLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ViewerHeader />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Outlet />
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route element={<ViewerLayout />}>
        <Route path="/flow/:uuid" element={<FlowView />} />
      </Route>
    </Routes>
  );
}
