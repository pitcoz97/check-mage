package validation

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Regole di registrazione, esposte anche da GET /auth/password-policy così il
// client non deve duplicarle.
const (
	UsernameMinLength = 3
	UsernameMaxLength = 20
	UsernamePattern   = `^[a-zA-Z0-9_]+$`

	PasswordMinLength = 8
	PasswordMaxLength = 72 // bcrypt tronca a 72 byte
)

var (
	emailRegex    = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	usernameRegex = regexp.MustCompile(UsernamePattern)
)

// Policy descrive le regole di validazione di username e password.
type Policy struct {
	Username UsernamePolicy `json:"username"`
	Password PasswordPolicy `json:"password"`
}

type UsernamePolicy struct {
	MinLength int    `json:"min_length"`
	MaxLength int    `json:"max_length"`
	Pattern   string `json:"pattern"`
}

type PasswordPolicy struct {
	MinLength        int  `json:"min_length"`
	MaxLength        int  `json:"max_length"`
	RequireUppercase bool `json:"require_uppercase"`
	RequireLowercase bool `json:"require_lowercase"`
	RequireDigit     bool `json:"require_digit"`
}

// CurrentPolicy restituisce le regole applicate da ValidateRegister.
func CurrentPolicy() Policy {
	return Policy{
		Username: UsernamePolicy{MinLength: UsernameMinLength, MaxLength: UsernameMaxLength, Pattern: UsernamePattern},
		Password: PasswordPolicy{
			MinLength:        PasswordMinLength,
			MaxLength:        PasswordMaxLength,
			RequireUppercase: true,
			RequireLowercase: true,
			RequireDigit:     true,
		},
	}
}

func ValidateRegister(username, email, password string) error {
	// Username
	username = strings.TrimSpace(username)
	if len(username) < UsernameMinLength {
		return fmt.Errorf("username deve avere almeno %d caratteri", UsernameMinLength)
	}
	if len(username) > UsernameMaxLength {
		return fmt.Errorf("username non può superare %d caratteri", UsernameMaxLength)
	}
	if !usernameRegex.MatchString(username) {
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
	if len(password) < PasswordMinLength {
		return fmt.Errorf("password deve avere almeno %d caratteri", PasswordMinLength)
	}
	if len(password) > PasswordMaxLength {
		// bcrypt tronca a 72 byte — meglio rifiutare subito
		return fmt.Errorf("password non può superare %d caratteri", PasswordMaxLength)
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
