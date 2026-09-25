package validation

import (
	"errors"
	"regexp"
	"strings"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

func ValidateRegister(username, email, password string) error {
	// Username
	username = strings.TrimSpace(username)
	if len(username) < 3 {
		return errors.New("username deve avere almeno 3 caratteri")
	}
	if len(username) > 20 {
		return errors.New("username non può superare 20 caratteri")
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9_]+$`).MatchString(username) {
		return errors.New("username può contenere solo lettere, numeri e underscore")
	}

	// Email
	if !emailRegex.MatchString(email) {
		return errors.New("email non valida")
	}

	// Password
	if err := ValidatePassword(password); err != nil {
		return err
	}

	return nil
}

func ValidatePassword(password string) error {
	if len(password) < 8 {
		return errors.New("password deve avere almeno 8 caratteri")
	}
	if len(password) > 72 {
		// bcrypt tronca a 72 byte — meglio rifiutare subito
		return errors.New("password non può superare 72 caratteri")
	}

	var hasUpper, hasLower, hasDigit bool
	for _, c := range password {
		switch {
		case c >= 'A' && c <= 'Z':
			hasUpper = true
		case c >= 'a' && c <= 'z':
			hasLower = true
		case c >= '0' && c <= '9':
			hasDigit = true
		}
	}

	if !hasUpper {
		return errors.New("password deve contenere almeno una lettera maiuscola")
	}
	if !hasLower {
		return errors.New("password deve contenere almeno una lettera minuscola")
	}
	if !hasDigit {
		return errors.New("password deve contenere almeno un numero")
	}

	return nil
}
