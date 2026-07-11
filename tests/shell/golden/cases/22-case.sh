case hi in h*) echo H;; *) echo other;; esac
case bye in h*) echo H;; *) echo other;; esac
case yes in y*|Y*) echo Y;; n*|N*) echo N;; *) echo other;; esac
case NO in y*|Y*) echo Y;; n*|N*) echo N;; *) echo other;; esac
case maybe in y*|Y*) echo Y;; n*|N*) echo N;; *) echo other;; esac
case abc in a*) echo first;; a*) echo second;; esac
