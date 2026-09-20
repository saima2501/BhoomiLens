import { Amplify } from "aws-amplify";

let configured = false;

export function configureAmplify(): void {
  if (configured) return;
  Amplify.configure(
    {
      Auth: {
        Cognito: {
          userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
          userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
          identityPoolId: process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID!,
        },
      },
    },
    { ssr: true },
  );
  configured = true;
}
