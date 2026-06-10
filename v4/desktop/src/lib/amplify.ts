// File: amplify
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import { Amplify } from 'aws-amplify';

// App de escritorio: NO hay SSO por cookie de apex (Electron no vive en
// *.pernexium.com.mx). Auth directa contra el mismo User Pool por username.
// Storage default (memoria/localStorage del renderer) basta aquí.
let configured = false;

export function configureAmplify(): void {
  if (configured) return;
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  if (!userPoolId || !userPoolClientId) {
    console.error('[amplify] faltan VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_ID');
    return;
  }
  Amplify.configure({
    Auth: { Cognito: { userPoolId, userPoolClientId } },
  });
  configured = true;
}
