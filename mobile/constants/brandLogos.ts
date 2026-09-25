import type { ImageSourcePropType } from 'react-native';

export const BRAND_LOGOS: Record<string, ImageSourcePropType> = {
  petron: require('../assets/images/petronlogo.png'),
  shell: require('../assets/images/shelllogo.png'),
  caltex: require('../assets/images/caltexlogo.png'),
  phoenix: require('../assets/images/phoenixlogo.png'),
  total: require('../assets/images/totallogo.jpeg'),
  'flying-v': require('../assets/images/flyingvlogo.webp'),
  unioil: require('../assets/images/unioillogo.jpeg'),
  seaoil: require('../assets/images/seaoillogo.png'),
  ptt: require('../assets/images/pttlogo.png'),
};

export function getBrandLogo(slug: string): ImageSourcePropType | undefined {
  return BRAND_LOGOS[slug];
}
