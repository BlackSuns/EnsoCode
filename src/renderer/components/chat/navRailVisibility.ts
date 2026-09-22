/** 铺满时正文贴到容器左缘，定位条感应带会盖住正文，所以不显示。不足两轮也没有可跳目标。 */
export function navRailEnabled(chatWide: boolean, turnCount: number): boolean {
  return !chatWide && turnCount >= 2;
}
