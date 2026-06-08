import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account & Sign In',
  description:
    'Sign in to your Castalia account or manage your Scriptorium repository and account settings.',
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
