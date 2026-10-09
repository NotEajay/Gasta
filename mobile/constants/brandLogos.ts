import type { ImageSourcePropType } from 'react-native';

const cleanfuelLogo = require('../assets/images/cleanfuellogo.png');

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
  cleanfuel: cleanfuelLogo,
  'clean-fuel': cleanfuelLogo,
  jetti: require('../assets/images/jettilogo.png'),
  'my-gas': require('../assets/images/mygaslogo.png'),
};

export function getBrandLogo(slug: string): ImageSourcePropType | undefined {
  return BRAND_LOGOS[slug];
}
