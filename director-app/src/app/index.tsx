// Root index — exists solely so Expo Router does not show "Unmatched Route"
// at the initial URL before _layout.tsx redirects to the correct group.
// The root layout's loading spinner covers this during bootstrap.
export default function Index() {
  return null;
}
