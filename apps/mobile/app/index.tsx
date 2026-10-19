import { Redirect } from 'expo-router';

// TODO: with a real DataSource, check ds.getSession() and redirect to /households when signed in.
export default function Index() {
  return <Redirect href="/sign-in" />;
}
