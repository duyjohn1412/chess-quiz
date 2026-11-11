export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

// Config công khai của project Firebase riêng 'chess' (Spark free plan).
// Hỗ trợ ghi đè qua biến môi trường VITE_FIREBASE_* nếu fork repo sang project khác.
export const FIREBASE_CONFIG: FirebasePublicConfig = {
  apiKey:
    (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) ||
    'AIzaSyCX3izsgMR6Xdz94UDR0H7FtVXj7CjBWcQ',
  authDomain:
    (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ||
    'chess-quiz-9x4k2m.firebaseapp.com',
  projectId:
    (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ||
    'chess-quiz-9x4k2m',
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ||
    'chess-quiz-9x4k2m.firebasestorage.app',
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) ||
    '952788364294',
  appId:
    (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) ||
    '1:952788364294:web:9639177fd7780a61096787',
};

export const FIREBASE_DATABASE_ID: string =
  (import.meta.env.VITE_FIREBASE_DATABASE_ID as string | undefined) || 'chess';

export const FIREBASE_EDITION: 'enterprise' | 'standard' =
  (import.meta.env.VITE_FIREBASE_EDITION as 'enterprise' | 'standard' | undefined) ||
  'enterprise';

export function hasFirebaseConfig(): boolean {
  return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.appId);
}
