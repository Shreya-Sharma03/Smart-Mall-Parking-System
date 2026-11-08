import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import VisitorDashboard from './pages/VisitorDashboard';
import './styles/App.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-root">
        <Routes>
          <Route path="/" element={<VisitorDashboard />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
