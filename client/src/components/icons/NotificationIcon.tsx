export function NotificationIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <g clipPath="url(#clip0_notif)">
        <path
          d="M5.55938 14.22C5.55938 14.66 5.22938 15 4.77938 15.11L3.99938 15.44C3.43938 15.77 3.10938 16.22 3.10938 16.77V17.55H20.8894V16.77C20.8894 16.21 20.5594 15.77 19.9994 15.44L19.2194 15.11C18.7794 15 18.4394 14.67 18.4394 14.22L17.7694 7.89C17.5494 6.33 16.5494 5.11 15.0994 4.45L13.6594 3.89C13.2194 3.67 12.8794 3.22 12.7694 2.78L12.5494 2H11.4394L11.2194 2.78C11.1094 3.22 10.7794 3.67 10.3294 3.89L8.88938 4.45C7.44938 5.12 6.44937 6.34 6.21937 7.89L5.90937 10.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7.56055 17.56C7.56055 20 9.56055 22 12.0005 22C14.4405 22 16.4405 20 16.4405 17.56"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <defs>
        <clipPath id="clip0_notif">
          <rect width="24" height="24" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
