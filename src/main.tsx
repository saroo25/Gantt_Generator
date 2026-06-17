import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../iscra_b_gantt_chart_generator';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
