import { Route, Routes } from 'react-router-dom';

import { FlowView } from './pages/flow-view.tsx';
import { Home } from './pages/home.tsx';

export function App() {
  return (
    <Routes>
      <Route path="/flow/:uuid" element={<FlowView />} />
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
