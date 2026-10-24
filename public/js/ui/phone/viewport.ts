// The shared phone breakpoint, including resizing a page between phone and laptop.
import { useEffect, useState } from 'preact/hooks';

export function usePhone() {
  const [phone, setPhone] = useState(() => matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const query = matchMedia('(max-width: 899px)'), change = () => setPhone(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return phone;
}
