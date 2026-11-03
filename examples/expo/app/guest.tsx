import { useState } from "react";
import { ScrollView, Text, TextInput } from "react-native";
import { AuthDataProvider } from "@forest-lab/auth-kit";
import { guestAuthData } from "../auth";
import { ActionButton, WorkflowFeedback } from "./index";

// An app that keeps guests: a visitor plays at once as a guest and may sign in or up later,
// keeping what they made (Better Auth links the guest to the account on the backend).
export default function Guest() {
  return (
    <AuthDataProvider client={guestAuthData}>
      <GuestSession />
    </AuthDataProvider>
  );
}

function GuestSession() {
  const guest = guestAuthData.useGuestSession();
  const [message, setMessage] = useState("");
  // The page waits for the first authentication only, then stays through identity changes.
  if (!guest.isEstablished)
    return <WorkflowFeedback feedback={guest.feedback} recoveryTitle="Retry guest sign-in" />;
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12, maxWidth: 800 }}>
      <Text accessibilityRole="header">Play as a guest</Text>
      <Text accessibilityRole="alert">{message}</Text>
      <Text>{guest.isAnonymous ? `Guest ${guest.userId}` : `Account ${guest.userId}`}</Text>
      {/* Roots stay above the guest/account switch so completion survives the identity change. */}
      <guestAuthData.SignInForm
        initialValues={{ email: "", password: "" }}
        onAuthenticated={({ guestUserId }) => setMessage(`Linked ${guestUserId}`)}
        onVerificationRequired={() => setMessage("Verification required")}
      >
        <guestAuthData.SignUpForm
          initialValues={{ name: "Guest", email: "", password: "" }}
          onVerificationRequired={() => setMessage("Verification required")}
        >
          <guestAuthData.SignOut onSignedOut={() => setMessage("Guest again")}>
            {guest.isAnonymous ? (
              <>
                <SignInControls />
                <SignUpControls />
              </>
            ) : (
              <SignOutControls />
            )}
          </guestAuthData.SignOut>
        </guestAuthData.SignUpForm>
      </guestAuthData.SignInForm>
    </ScrollView>
  );
}

function SignInControls() {
  const form = guestAuthData.useSignInFormContext();
  return (
    <>
      <TextInput
        accessibilityLabel="Guest sign-in email"
        value={form.field("email").value}
        onChangeText={form.field("email").onChange}
      />
      <TextInput
        accessibilityLabel="Guest sign-in password"
        secureTextEntry
        value={form.field("password").value}
        onChangeText={form.field("password").onChange}
      />
      <ActionButton title="Sign in" action={form.actions.submit} />
      <WorkflowFeedback feedback={form.feedback} recoveryTitle="Retry sign-in refresh" />
    </>
  );
}

function SignUpControls() {
  const form = guestAuthData.useSignUpFormContext();
  return (
    <>
      <TextInput
        accessibilityLabel="Guest sign-up email"
        value={form.field("email").value}
        onChangeText={form.field("email").onChange}
      />
      <TextInput
        accessibilityLabel="Guest sign-up password"
        secureTextEntry
        value={form.field("password").value}
        onChangeText={form.field("password").onChange}
      />
      <ActionButton title="Sign up" action={form.actions.submit} />
      <WorkflowFeedback feedback={form.feedback} recoveryTitle="Retry sign-up refresh" />
    </>
  );
}

function SignOutControls() {
  const workflow = guestAuthData.useSignOutContext();
  return (
    <>
      <ActionButton title="Sign out" action={workflow.actions.signOut} />
      <WorkflowFeedback feedback={workflow.feedback} recoveryTitle="Retry sign-out refresh" />
    </>
  );
}
