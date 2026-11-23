import { createPortal } from 'react-dom'

// 分屏窗格带有 container-type，会形成 fixed 子元素的包含块。
// 抽屉 / 弹窗统一挂到 body，避免被裁进单个窗格。
export default function Portal({ children }) {
  return createPortal(children, document.body)
}
