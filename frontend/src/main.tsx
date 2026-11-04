import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {MotionConfig} from 'motion/react';
import {AppearanceProvider} from './components/AppearanceProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider><MotionConfig reducedMotion="user"><App /></MotionConfig></AppearanceProvider>
  </StrictMode>,
);
