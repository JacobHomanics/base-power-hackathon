declare module 'react-native-web' {
  import type { ReactElement } from 'react';

  export function unstable_createElement(
    type: string,
    props?: object | null,
  ): ReactElement;
}
